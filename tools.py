import json, os, re, subprocess, sys, tempfile
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import urlparse, parse_qs
import requests

TOOL_TIMEOUT_SECONDS  = int(os.getenv("TOOL_TIMEOUT_SECONDS", "20"))
TOOL_OUTPUT_MAX_CHARS = int(os.getenv("TOOL_OUTPUT_MAX_CHARS", "8000"))

FETCH_MAX_BYTES = 2 * 1024 * 1024
REQUEST_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
}

def _truncate(text: str) -> str:
    if len(text) > TOOL_OUTPUT_MAX_CHARS:
        omitted = len(text) - TOOL_OUTPUT_MAX_CHARS
        return text[:TOOL_OUTPUT_MAX_CHARS] + f"\n... [truncated {omitted} characters]"
    return text

def run_python(code: str = "") -> str:
    if not str(code).strip():
        return "Error: no code provided."
    with tempfile.TemporaryDirectory(prefix="tool_py_") as tmpdir:
        script = os.path.join(tmpdir, "script.py")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write(str(code))
        try:
            proc = subprocess.run(
                [sys.executable, "-I", script],
                capture_output=True, text=True,
                timeout=TOOL_TIMEOUT_SECONDS, cwd=tmpdir,
            )
        except subprocess.TimeoutExpired:
            return f"Error: script exceeded the {TOOL_TIMEOUT_SECONDS} second timeout."
        parts = []
        if proc.stdout:
            parts.append(proc.stdout.rstrip())
        if proc.stderr:
            parts.append("[stderr]\n" + proc.stderr.rstrip())
        if proc.returncode != 0:
            parts.append(f"[exit code {proc.returncode}]")
        out = "\n".join(parts).strip()
        return _truncate(out or "(script produced no output; use print() to return results)")

def get_current_datetime() -> str:
    return datetime.now().astimezone().strftime("%A, %B %d, %Y at %I:%M %p %Z")

_TEX_WRAPPER_RE = re.compile(r"\{\\(?:display|text)style(?![a-zA-Z])\s*([\s\S]*?)\s*\}")

class _TextExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head",
                 "nav", "aside", "footer", "form", "button"}
    BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
                  "section", "article", "header", "footer", "ul", "ol", "table",
                  "blockquote", "pre"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._math_depth = 0
        self._math_display = False
        self._math_alttext = ""
        self._mathwrap_depth = 0
        self._tex_depth = 0
        self._tex_parts = []
        self._parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "math":
            self._math_depth += 1
            if self._math_depth == 1:
                a = dict(attrs)
                self._math_alttext = a.get("alttext") or ""
                self._math_display = (a.get("display") or "") == "block"
            return
        if self._math_depth:
            if tag == "annotation" and "tex" in (dict(attrs).get("encoding") or ""):
                self._tex_depth += 1
            return
        if self._mathwrap_depth:
            if tag == "span":
                self._mathwrap_depth += 1
            return
        if tag == "span" and "mwe-math" in (dict(attrs).get("class") or ""):
            self._mathwrap_depth = 1
        elif tag in self.SKIP_TAGS:
            self._skip_depth += 1
        elif tag in self.BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "math":
            if self._math_depth:
                self._math_depth -= 1
                if not self._math_depth:
                    self._flush_tex()
            return
        if self._math_depth:
            if tag == "annotation":
                self._tex_depth = max(0, self._tex_depth - 1)
            return
        if self._mathwrap_depth:
            if tag == "span":
                self._mathwrap_depth -= 1
            return
        if tag in self.SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in self.BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data):
        if self._math_depth:
            if self._tex_depth and data:
                self._tex_parts.append(data)
        elif not self._mathwrap_depth and not self._skip_depth and data:
            self._parts.append(data)

    def _flush_tex(self):
        tex = " ".join("".join(self._tex_parts).split())
        self._tex_parts = []
        alt = " ".join(self._math_alttext.split())
        self._math_alttext = ""
        if len(alt) > len(tex):
            tex = alt
        match = _TEX_WRAPPER_RE.fullmatch(tex)
        if match:
            tex = match.group(1)
        if tex and not self._skip_depth:
            if self._math_display:
                self._parts.append(f"\n$${tex}$$\n")
            else:
                self._parts.append(f" ${tex}$ ")
        self._math_display = False

    def text(self) -> str:
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in "".join(self._parts).split("\n")]
        out = []
        for ln in lines:
            if ln:
                out.append(ln)
            elif out and out[-1] != "":
                out.append("")
        return "\n".join(out).strip()

def _ddg_unwrap(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return target or href
    return href

class _DDGResultParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.results = []
        self._in_title = False
        self._in_snippet = False

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        a = dict(attrs)
        cls = a.get("class") or ""
        if "result__a" in cls:
            self._in_title = True
            self.results.append({"title": "", "url": _ddg_unwrap(a.get("href") or ""), "snippet": ""})
        elif "result__snippet" in cls and self.results:
            self._in_snippet = True

    def handle_endtag(self, tag):
        if tag == "a":
            self._in_title = False
            self._in_snippet = False

    def handle_data(self, data):
        if self._in_title and self.results:
            self.results[-1]["title"] += data
        elif self._in_snippet and self.results:
            self.results[-1]["snippet"] += data

TIME_RANGE_CODES = {"day": "d", "week": "w", "month": "m", "year": "y"}
DEEP_READ_COUNT = 3
DEEP_READ_CHARS = 2500

def _page_extract(url):
    text, err = _fetch_page_text(url, timeout=10)
    if err:
        return f"(could not read page: {err})"
    joined = "\n".join(ln.strip() for ln in (text or "").split("\n") if ln.strip())
    if not joined:
        return "(page had no readable text)"
    if len(joined) > DEEP_READ_CHARS:
        joined = joined[:DEEP_READ_CHARS] + "…"
    return joined

def search_web(query: str = "", max_results=10, time_range=None, read_pages=False) -> str:
    query = str(query).strip()
    if not query:
        return "Error: no search query provided."
    try:
        max_results = max(1, min(10, int(max_results)))
    except (TypeError, ValueError):
        max_results = 10
    payload = {"q": query}
    key = str(time_range).strip().lower() if time_range else ""
    df = TIME_RANGE_CODES.get(key) or (key if key in TIME_RANGE_CODES.values() else None)
    if df:
        payload["df"] = df
    deep = str(read_pages).strip().lower() in ("true", "1", "yes")
    try:
        r = requests.post(
            "https://html.duckduckgo.com/html/",
            data=payload,
            headers=REQUEST_HEADERS,
            timeout=20,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        return f"Error: web search failed: {e}"
    parser = _DDGResultParser()
    try:
        parser.feed(r.text)
        parser.close()
    except Exception:
        pass
    results = [
        res for res in parser.results
        if res["url"] and not urlparse(res["url"]).netloc.endswith("duckduckgo.com")
    ][:max_results]
    if not results:
        return "No results found."
    lines = []
    for i, res in enumerate(results, 1):
        title = " ".join(res["title"].split()) or "(untitled)"
        snippet = " ".join(res["snippet"].split())
        entry = f"{i}. {title}\n   {res['url']}"
        if snippet:
            entry += f"\n   {snippet}"
        if deep and i <= DEEP_READ_COUNT:
            extract = _page_extract(res["url"])
            entry += "\n   Page content:\n" + "\n".join(
                "      " + ln for ln in extract.split("\n")
            )
        lines.append(entry)
    return _truncate("\n\n".join(lines))

def _fetch_page_text(url, timeout=20):
    url = str(url).strip()
    if not url:
        return None, "no URL provided."
    if not urlparse(url).scheme:
        url = "https://" + url
    if urlparse(url).scheme not in ("http", "https"):
        return None, "only http and https URLs are supported."
    try:
        with requests.get(url, headers=REQUEST_HEADERS, timeout=timeout,
                          stream=True, allow_redirects=True) as r:
            r.raise_for_status()
            content_type = (r.headers.get("content-type") or "").lower()
            encoding = r.encoding
            raw = b""
            for chunk in r.iter_content(chunk_size=65536):
                raw += chunk
                if len(raw) >= FETCH_MAX_BYTES:
                    break
    except requests.RequestException as e:
        return None, f"could not fetch {url}: {e}"
    text = raw.decode(encoding or "utf-8", errors="replace")
    if "html" in content_type or re.match(r"\s*<", text):
        extractor = _TextExtractor()
        try:
            extractor.feed(text)
            extractor.close()
        except Exception:
            pass
        text = extractor.text() or text
    return text.strip(), None

def fetch_url(url: str = "") -> str:
    text, err = _fetch_page_text(url)
    if err:
        return f"Error: {err}"
    return _truncate(text or "(empty response)")

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": (
                "Execute a complete Python 3 script on the server and return its "
                "stdout and stderr. Use print() to output any values you need back. "
                "The Python standard library is available. Useful for math, dates, "
                "text and data processing, and quick simulations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The complete Python 3 script to execute.",
                    }
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": "Get the current local date and time on the server.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search the web with DuckDuckGo and return the top results as "
                "numbered titles, URLs, and snippets. Set read_pages to true to "
                "also download the top pages and include text extracts - use that "
                "when snippets alone will not answer the question. Use time_range "
                "for recent events. Follow up with fetch_url to read any single "
                "result in full."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query.",
                    },
                    "time_range": {
                        "type": "string",
                        "enum": ["day", "week", "month", "year"],
                        "description": "Only return results from this recent period. Omit to search all time.",
                    },
                    "read_pages": {
                        "type": "boolean",
                        "description": "If true, also download the top 3 result pages and include a text extract of each. Slower, but returns real page content instead of just snippets.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": (
                "Download a web page over http or https and return its readable "
                "text content with HTML markup stripped. Long pages are truncated."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL of the page to fetch.",
                    }
                },
                "required": ["url"],
            },
        },
    },
]

TOOL_HANDLERS = {
    "run_python": run_python,
    "get_current_datetime": get_current_datetime,
    "search_web": search_web,
    "fetch_url": fetch_url,
}

def execute_tool(name: str, arguments) -> str:
    handler = TOOL_HANDLERS.get(name)
    if handler is None:
        return f"Error: unknown tool '{name}'."
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except ValueError:
            arguments = {}
    if not isinstance(arguments, dict):
        arguments = {}
    try:
        return str(handler(**arguments))
    except TypeError as e:
        return f"Error: invalid arguments for {name}: {e}"
    except Exception as e:
        return f"Error while running {name}: {e}"
