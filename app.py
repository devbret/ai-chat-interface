import os, json, base64, shutil, tempfile, subprocess
from typing import List
from flask import Flask, request, render_template, jsonify, Response, stream_with_context, abort
import requests
from dotenv import load_dotenv

load_dotenv()

def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return val

def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(f"Environment variable {name} must be an integer (got {raw!r}).")

OLLAMA_BASE_URL = _require_env("OLLAMA_BASE_URL")
OLLAMA_MODEL    = _require_env("OLLAMA_MODEL")

MAX_UPLOAD_MB        = _int_env("MAX_UPLOAD_MB", 10)
MAX_VIDEO_UPLOAD_MB  = _int_env("MAX_VIDEO_UPLOAD_MB", 50)
VIDEO_FRAMES         = _int_env("VIDEO_FRAMES", 8)
VIDEO_FRAME_WIDTH    = _int_env("VIDEO_FRAME_WIDTH", 768)
ANALYSIS_NUM_CTX     = _int_env("ANALYSIS_NUM_CTX", 32768)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = max(MAX_UPLOAD_MB, MAX_VIDEO_UPLOAD_MB) * 1024 * 1024
ALLOWED_EXTS = {".txt"}
VIDEO_EXTS   = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}

def _ollama_chat(messages, stream=False, options=None, model=None):
    payload = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
        "stream": stream,
        "options": options or {}
    }
    return requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload, stream=stream, timeout=600)

def _enforce_upload_limit(limit_mb: int):
    length = request.content_length
    if length is not None and length > limit_mb * 1024 * 1024:
        abort(413, description=f"Upload exceeds the {limit_mb} MB limit.")

def _read_txt_from_upload(file_storage):
    name = (file_storage.filename or "").lower()
    if not any(name.endswith(ext) for ext in ALLOWED_EXTS):
        abort(400, description="Only .txt files are allowed.")
    data = file_storage.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        abort(413, description=f"Text file exceeds the {MAX_UPLOAD_MB} MB limit.")
    return data.decode("utf-8", errors="replace")

def _probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0

def _extract_video_frames(file_storage, num_frames: int = VIDEO_FRAMES,
                          width: int = VIDEO_FRAME_WIDTH) -> List[str]:
    name = (file_storage.filename or "").lower()
    ext = os.path.splitext(name)[1]
    if ext not in VIDEO_EXTS:
        abort(400, description="Unsupported video type. Allowed: " + ", ".join(sorted(VIDEO_EXTS)))
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        abort(500, description="ffmpeg/ffprobe are required for video analysis but were not found on the server.")

    tmpdir = tempfile.mkdtemp(prefix="vid_")
    frames: List[str] = []
    try:
        in_path = os.path.join(tmpdir, "input" + ext)
        file_storage.save(in_path)

        duration = _probe_duration(in_path)
        if duration and duration > 0:
            timestamps = [duration * (i + 0.5) / num_frames for i in range(num_frames)]
        else:
            timestamps = [0.0]

        for idx, ts in enumerate(timestamps):
            out_path = os.path.join(tmpdir, f"frame_{idx:03d}.jpg")
            cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{ts:.3f}",
                   "-i", in_path, "-frames:v", "1",
                   "-vf", f"scale='min({width},iw)':-2", "-q:v", "3", out_path]
            try:
                subprocess.run(cmd, capture_output=True, timeout=60, check=False)
            except Exception:
                continue
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as fh:
                    frames.append(base64.b64encode(fh.read()).decode("ascii"))

        if not frames:
            abort(400, description="Could not extract any frames from the video.")
        return frames
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

def _video_messages(frames: List[str], task: str = "") -> List[dict]:
    sys = ("You are a careful video analyst. You are given a sequence of still frames "
           "sampled in chronological order from a short video. Reason about what happens "
           "across the clip — describe the setting, key objects, people, actions, any visible "
           "text, and how things change from frame to frame. Present one coherent account of "
           "the video rather than describing each frame in isolation.")
    user_text = task.strip() if task else "Describe what is happening in this video."
    user_text += (f"\n\n(The {len(frames)} attached images are frames sampled evenly "
                  "from the video, in chronological order.)")
    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": user_text, "images": frames},
    ]

def _resolve_frame_count(raw) -> int:
    if not raw:
        return VIDEO_FRAMES
    try:
        return max(1, min(32, int(raw)))
    except (TypeError, ValueError):
        return VIDEO_FRAMES

def _chunk_text(text: str, max_chars: int = 6000) -> List[str]:
    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_chars, n)
        cut = text.rfind("\n\n", start, end)
        if cut == -1 or cut <= start + int(max_chars * 0.5):
            cut = end
        chunks.append(text[start:cut].strip())
        start = cut
    return [c for c in chunks if c]

def _summarize_chunk(chunk: str, extra_instruction: str = "", model=None) -> str:
    sys = "You are a precise summarizer. Extract the key ideas succinctly."
    if extra_instruction:
        sys += " " + extra_instruction.strip()
    r = _ollama_chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": f"Summarize the following text:\n\n{chunk}"}
        ],
        stream=False,
        options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": 512},
        model=model
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "").strip()

def _final_synthesis(summaries: List[str], user_task: str = "Provide a concise overall summary with key themes, insights, and any notable entities/dates.", model=None) -> str:
    joined = "\n\n---\n\n".join(summaries)
    r = _ollama_chat(
        [
            {"role": "system", "content": "You are an expert analyst. Synthesize multiple summaries into one clear, structured brief."},
            {"role": "user", "content": f"{user_task}\n\nHere are section summaries:\n\n{joined}"}
        ],
        stream=False,
        options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": -1},
        model=model
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "").strip()

def _raise_for_status_streaming(r):
    if r.status_code >= 400:
        try:
            r.content
        except Exception:
            pass
    r.raise_for_status()

def _ollama_error_message(e: requests.RequestException) -> str:
    resp = getattr(e, "response", None)
    if resp is None:
        return f"Upstream Ollama request failed: {e}"
    detail = ""
    try:
        body = resp.json()
        if isinstance(body, dict):
            detail = str(body.get("error") or "").strip()
    except Exception:
        try:
            detail = (resp.text or "").strip()
        except Exception:
            detail = ""
    if detail:
        return f"Ollama returned HTTP {resp.status_code}: {detail[:1000]}"
    return f"Ollama returned HTTP {resp.status_code}: {resp.reason or 'error'}"

@app.errorhandler(requests.RequestException)
def handle_upstream_error(e):
    return jsonify({"error": _ollama_error_message(e)}), 502

@app.get("/")
def home():
    return render_template("index.html", model=OLLAMA_MODEL)

@app.post("/api/chat-sync")
def chat_sync():
    data = request.get_json(force=True) or {}
    messages = data.get("messages") or []
    options  = data.get("options") or {}
    model    = data.get("model") or OLLAMA_MODEL

    r = _ollama_chat(messages, stream=False, options=options, model=model)
    r.raise_for_status()
    j = r.json()
    return jsonify({
        "role": j.get("message", {}).get("role", "assistant"),
        "content": j.get("message", {}).get("content", ""),
        "raw": j
    })

@app.post("/api/chat-stream")
def chat_stream():
    data = request.get_json(force=True) or {}
    messages = data.get("messages") or []
    options  = data.get("options") or {}
    model    = data.get("model") or OLLAMA_MODEL

    def sse_from_ollama():
        try:
            with _ollama_chat(messages, stream=True, options=options, model=model) as r:
                _raise_for_status_streaming(r)
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        j = json.loads(line.decode("utf-8"))
                    except Exception:
                        continue
                    if "message" in j and "content" in j["message"]:
                        yield f"data: {json.dumps({'delta': j['message']['content'], 'done': False})}\n\n"
                    if j.get("done"):
                        yield "data: {\"done\": true}\n\n"
        except requests.RequestException as e:
            yield f"data: {json.dumps({'error': _ollama_error_message(e)})}\n\n"

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"}
    return Response(stream_with_context(sse_from_ollama()), headers=headers)

@app.get("/api/models")
def list_models():
    r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=30)
    r.raise_for_status()
    return jsonify(r.json())

@app.post("/api/analyze-file")
def analyze_file_sync():
    _enforce_upload_limit(MAX_UPLOAD_MB)
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task = request.form.get("task", "").strip()
    model = request.form.get("model") or None

    text = _read_txt_from_upload(f)
    chunks = _chunk_text(text, max_chars=6000)

    if len(chunks) == 1:
        sys = "You are a precise analyst."
        prompt = f"{task or 'Summarize the main points clearly.'}\n\nText:\n{text}"
        r = _ollama_chat(
            [{"role": "system", "content": sys},
             {"role": "user", "content": prompt}],
            stream=False,
            options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": -1},
            model=model
        )
        r.raise_for_status()
        out = r.json().get("message", {}).get("content", "").strip()
        return jsonify({"result": out, "chunks": 1})

    summaries = [_summarize_chunk(c, extra_instruction=task, model=model) for c in chunks]
    final = _final_synthesis(summaries, user_task=task or "Provide a concise overall summary with key themes, insights, and notable entities/dates.", model=model)
    return jsonify({"result": final, "chunks": len(chunks)})

@app.post("/api/analyze-file-stream")
def analyze_file_stream():
    _enforce_upload_limit(MAX_UPLOAD_MB)
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task = request.form.get("task", "").strip()
    model = request.form.get("model") or None
    text = _read_txt_from_upload(f)
    chunks = _chunk_text(text, max_chars=6000)

    def run():
        try:
            if len(chunks) == 1:
                sys = "You are a precise analyst."
                prompt = f"{task or 'Summarize the main points clearly.'}\n\nText:\n{chunks[0]}"
                with _ollama_chat(
                    [{"role": "system", "content": sys},
                     {"role": "user", "content": prompt}],
                    stream=True,
                    options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": -1},
                    model=model
                ) as r:
                    _raise_for_status_streaming(r)
                    assembled = []
                    for line in r.iter_lines():
                        if not line:
                            continue
                        try: j = json.loads(line.decode("utf-8"))
                        except Exception: continue
                        if "message" in j and "content" in j["message"]:
                            delta = j["message"]["content"]
                            assembled.append(delta)
                            yield f"data: {json.dumps({'stage':'final','delta':delta})}\n\n"
                        if j.get("done"):
                            text_final = "".join(assembled)
                            yield f"data: {json.dumps({'stage':'final','text':text_final})}\n\n"
                            yield "data: {\"done\": true}\n\n"
                            return
                yield f"data: {json.dumps({'stage':'final','text':''.join(assembled)})}\n\n"
                yield "data: {\"done\": true}\n\n"
                return
            summaries = []
            N = len(chunks)
            for i, c in enumerate(chunks, start=1):
                s = _summarize_chunk(c, extra_instruction=task, model=model)
                summaries.append(s)
                yield f"data: {json.dumps({'stage':'chunk','index':i,'of':N,'summary':s})}\n\n"
            final = _final_synthesis(summaries, user_task=task or "Provide a concise overall summary with key themes, insights, and notable entities/dates.", model=model)
            yield f"data: {json.dumps({'stage':'final','text':final})}\n\n"
            yield "data: {\"done\": true}\n\n"
        except requests.RequestException as e:
            yield f"data: {json.dumps({'error': _ollama_error_message(e)})}\n\n"

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"}
    return Response(stream_with_context(run()), headers=headers)

@app.post("/api/analyze-video")
def analyze_video_sync():
    _enforce_upload_limit(MAX_VIDEO_UPLOAD_MB)
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task  = request.form.get("task", "").strip()
    model = request.form.get("model") or None
    num_frames = _resolve_frame_count(request.form.get("frames"))

    frames = _extract_video_frames(f, num_frames=num_frames)
    r = _ollama_chat(
        _video_messages(frames, task),
        stream=False,
        options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": -1},
        model=model
    )
    r.raise_for_status()
    out = r.json().get("message", {}).get("content", "").strip()
    return jsonify({"result": out, "frames": len(frames)})

@app.post("/api/analyze-video-stream")
def analyze_video_stream():
    _enforce_upload_limit(MAX_VIDEO_UPLOAD_MB)
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task  = request.form.get("task", "").strip()
    model = request.form.get("model") or None
    num_frames = _resolve_frame_count(request.form.get("frames"))

    frames = _extract_video_frames(f, num_frames=num_frames)
    messages = _video_messages(frames, task)

    def run():
        yield f"data: {json.dumps({'stage':'frames','frames':len(frames)})}\n\n"
        try:
            with _ollama_chat(
                messages,
                stream=True,
                options={"temperature": 0.2, "num_ctx": ANALYSIS_NUM_CTX, "num_predict": -1},
                model=model
            ) as r:
                _raise_for_status_streaming(r)
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        j = json.loads(line.decode("utf-8"))
                    except Exception:
                        continue
                    if "message" in j and "content" in j["message"]:
                        yield f"data: {json.dumps({'delta': j['message']['content']})}\n\n"
                    if j.get("done"):
                        yield "data: {\"done\": true}\n\n"
                        return
        except requests.RequestException as e:
            yield f"data: {json.dumps({'error': _ollama_error_message(e)})}\n\n"

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"}
    return Response(stream_with_context(run()), headers=headers)

if __name__ == "__main__":
    host  = os.getenv("HOST", "127.0.0.1")
    port  = _int_env("PORT", 8000)
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    app.run(host=host, port=port, debug=debug)
