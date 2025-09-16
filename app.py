import os, json
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

MAX_UPLOAD_MB   = _int_env("MAX_UPLOAD_MB", 10)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_EXTS = {".txt"}

def _ollama_chat(messages, stream=False, options=None, model=None):
    payload = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
        "stream": stream,
        "options": options or {}
    }
    return requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload, stream=stream, timeout=600)

def _read_txt_from_upload(file_storage):
    name = (file_storage.filename or "").lower()
    if not any(name.endswith(ext) for ext in ALLOWED_EXTS):
        abort(400, description="Only .txt files are allowed.")
    data = file_storage.read()
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        abort(400, description="Could not decode file as UTF-8 text.")

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

def _summarize_chunk(chunk: str, extra_instruction: str = "") -> str:
    sys = "You are a precise summarizer. Extract the key ideas succinctly."
    if extra_instruction:
        sys += " " + extra_instruction.strip()
    r = _ollama_chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": f"Summarize the following text:\n\n{chunk}"}
        ],
        stream=False,
        options={"temperature": 0.2, "num_ctx": 8192, "num_predict": 512}
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "").strip()

def _final_synthesis(summaries: List[str], user_task: str = "Provide a concise overall summary with key themes, insights, and any notable entities/dates.") -> str:
    joined = "\n\n---\n\n".join(summaries)
    r = _ollama_chat(
        [
            {"role": "system", "content": "You are an expert analyst. Synthesize multiple summaries into one clear, structured brief."},
            {"role": "user", "content": f"{user_task}\n\nHere are section summaries:\n\n{joined}"}
        ],
        stream=False,
        options={"temperature": 0.2, "num_ctx": 8192, "num_predict": 700}
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "").strip()

@app.get("/")
def home():
    return render_template("index.html", model=OLLAMA_MODEL)

@app.post("/api/chat-sync")
def chat_sync():
    data = request.get_json(force=True) or {}
    messages = data.get("messages") or []
    options  = data.get("options") or {}
    model    = data.get("model") or OLLAMA_MODEL

    r = requests.post(f"{OLLAMA_BASE_URL}/api/chat",
                      json={"model": model, "messages": messages, "stream": False, "options": options},
                      timeout=600)
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
        with requests.post(f"{OLLAMA_BASE_URL}/api/chat",
                           json={"model": model, "messages": messages, "stream": True, "options": options},
                           stream=True, timeout=600) as r:
            r.raise_for_status()
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

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"}
    return Response(stream_with_context(sse_from_ollama()), headers=headers)

@app.get("/api/models")
def list_models():
    r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=30)
    r.raise_for_status()
    return jsonify(r.json())

@app.post("/api/analyze-file")
def analyze_file_sync():
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task = request.form.get("task", "").strip()

    text = _read_txt_from_upload(f)
    chunks = _chunk_text(text, max_chars=6000)

    if len(chunks) == 1:
        sys = "You are a precise analyst."
        prompt = f"{task or 'Summarize the main points clearly.'}\n\nText:\n{text}"
        r = _ollama_chat(
            [{"role": "system", "content": sys},
             {"role": "user", "content": prompt}],
            stream=False,
            options={"temperature": 0.2, "num_ctx": 8192, "num_predict": 700}
        )
        r.raise_for_status()
        out = r.json().get("message", {}).get("content", "").strip()
        return jsonify({"result": out, "chunks": 1})

    summaries = [_summarize_chunk(c, extra_instruction=task) for c in chunks]
    final = _final_synthesis(summaries, user_task=task or "Provide a concise overall summary with key themes, insights, and notable entities/dates.")
    return jsonify({"result": final, "chunks": len(chunks)})

@app.post("/api/analyze-file-stream")
def analyze_file_stream():
    if "file" not in request.files:
        abort(400, description="Missing file.")
    f = request.files["file"]
    task = request.form.get("task", "").strip()
    text = _read_txt_from_upload(f)
    chunks = _chunk_text(text, max_chars=6000)

    def run():
        if len(chunks) == 1:
            sys = "You are a precise analyst."
            prompt = f"{task or 'Summarize the main points clearly.'}\n\nText:\n{chunks[0]}"
            with _ollama_chat(
                [{"role": "system", "content": sys},
                 {"role": "user", "content": prompt}],
                stream=True,
                options={"temperature": 0.2, "num_ctx": 8192, "num_predict": 700}
            ) as r:
                r.raise_for_status()
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
        summaries = []
        N = len(chunks)
        for i, c in enumerate(chunks, start=1):
            s = _summarize_chunk(c, extra_instruction=task)
            summaries.append(s)
            yield f"data: {json.dumps({'stage':'chunk','index':i,'of':N,'summary':s})}\n\n"
        final = _final_synthesis(summaries, user_task=task or "Provide a concise overall summary with key themes, insights, and notable entities/dates.")
        yield f"data: {json.dumps({'stage':'final','text':final})}\n\n"
        yield "data: {\"done\": true}\n\n"

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"}
    return Response(stream_with_context(run()), headers=headers)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
