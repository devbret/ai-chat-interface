const chatEl = document.getElementById("chat");
const composer = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sysEl = document.getElementById("system");
const streamToggle = document.getElementById("streamToggle");
const sysToggle = document.getElementById("sysToggle");
const tempEl = document.getElementById("temp");
const numPredictEl = document.getElementById("numPredict");
const numCtxEl = document.getElementById("numCtx");

const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const fileBadge = document.getElementById("fileBadge");
const clearFileBtn = document.getElementById("clearFileBtn");
const taskInput = document.getElementById("taskInput");
const fileStreamToggle = document.getElementById("fileStreamToggle");

const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");

let messages = [];
let currentAbort = null;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(url) {
  const trimmed = (url || "").trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "#";
}
function renderMarkdown(md = "") {
  let source = escapeHtml(md);

  source = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${cls}>${code}</code></pre>`;
  });

  source = source.replace(/^\s*---\s*$/gm, "<hr>");

  source = source.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  source = source.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  source = source.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  source = source.replace(/^# (.*)$/gm, "<h1>$1</h1>");

  source = source.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");

  source = source.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  source = source.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  source = source.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  source = source.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, text, url) =>
      `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  source = source.replace(/(?:^|\n)(- .+(?:\n- .+)*)/g, (match, listBlock) => {
    const items = listBlock
      .trim()
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .map((item) => `<li>${item}</li>`)
      .join("");
    return `\n<ul>${items}</ul>`;
  });

  source = source.replace(
    /(?:^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g,
    (match, listBlock) => {
      const items = listBlock
        .trim()
        .split("\n")
        .map((line) => line.replace(/^\d+\. /, "").trim())
        .map((item) => `<li>${item}</li>`)
        .join("");
      return `\n<ol>${items}</ol>`;
    },
  );

  const blocks = source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const html = blocks
    .map((block) => {
      if (
        /^<(h1|h2|h3|h4|ul|ol|pre|blockquote|hr)/.test(block) ||
        /^<li>/.test(block)
      ) {
        return block;
      }
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return html;
}

function createMessage(role, text = "", options = {}) {
  const {
    tag = "",
    state = "",
    markdown = false,
    time = formatTime(),
  } = options;

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const meta = document.createElement("div");
  meta.className = "meta";

  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = role;

  const timeEl = document.createElement("span");
  timeEl.className = "time";
  timeEl.textContent = time;

  meta.appendChild(roleEl);
  meta.appendChild(timeEl);

  if (tag) {
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    meta.appendChild(tagEl);
  }

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  if (state) bubble.classList.add(state);

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  chatEl.appendChild(wrapper);

  setBubbleContent(bubble, text, { markdown });
  scrollChatToBottom();

  return { wrapper, bubble, meta };
}

function setBubbleContent(bubble, text, { markdown = false } = {}) {
  if (markdown) {
    bubble.classList.add("md");
    bubble.innerHTML = renderMarkdown(text || "");
  } else {
    bubble.classList.remove("md");
    bubble.textContent = text || "";
  }
}

function setBubbleState(bubble, state) {
  bubble.classList.remove("pending", "error", "canceled", "done", "status");
  if (state) bubble.classList.add(state);
}

function setMessageTag(messageObj, tagText) {
  const existing = messageObj.meta.querySelector(".tag");
  if (existing) {
    existing.textContent = tagText;
    return;
  }
  const tagEl = document.createElement("span");
  tagEl.className = "tag";
  tagEl.textContent = tagText;
  messageObj.meta.appendChild(tagEl);
}

function addTypingIndicator(bubble) {
  bubble.classList.remove("md");
  bubble.innerHTML = `
    <div class="typing" aria-label="Assistant is responding">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  `;
}

function scrollChatToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function appendAssistantMessageToHistory(content) {
  messages.push({ role: "assistant", content });
}

function getGenOptions() {
  return {
    temperature: parseFloat(tempEl.value || "0.2"),
    num_predict: parseInt(numPredictEl.value || "512", 10),
    num_ctx: parseInt(numCtxEl.value || "8192", 10),
  };
}

function setStreamingUI(isStreaming) {
  sendBtn.disabled = isStreaming;
  stopBtn.hidden = !isStreaming;
  composer.classList.toggle("busy", isStreaming);

  promptEl.disabled = isStreaming;
  sysEl.disabled = isStreaming;
  streamToggle.disabled = isStreaming;
  sysToggle.disabled = isStreaming;
  tempEl.disabled = isStreaming;
  numPredictEl.disabled = isStreaming;
  numCtxEl.disabled = isStreaming;

  attachBtn.disabled = isStreaming;
  fileInput.disabled = isStreaming;
  taskInput.disabled = isStreaming;
  fileStreamToggle.disabled = isStreaming;
  clearFileBtn.disabled = isStreaming;
}

stopBtn.addEventListener("click", () => {
  if (currentAbort) currentAbort.abort();
});

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) {
    fileBadge.hidden = false;
    fileBadge.textContent = f.name;
    clearFileBtn.hidden = false;
  } else {
    clearFileBadge();
  }
});

clearFileBtn.addEventListener("click", () => {
  fileInput.value = "";
  clearFileBadge();
});

function clearFileBadge() {
  fileBadge.hidden = true;
  fileBadge.textContent = "";
  clearFileBtn.hidden = true;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();

  const f = fileInput.files?.[0];
  if (f) {
    const task = taskInput.value.trim();
    const announce = task
      ? `Analyze: ${f.name} — ${task}`
      : `Analyze: ${f.name}`;

    createMessage("user", announce, {
      tag: "file",
      markdown: false,
    });

    const assistantMsg = createMessage("assistant", "", {
      tag: fileStreamToggle.checked ? "file • stream" : "file • sync",
      state: "pending",
      markdown: false,
    });

    addTypingIndicator(assistantMsg.bubble);

    try {
      if (fileStreamToggle.checked) {
        await analyzeFileStreamToChat(f, task, assistantMsg);
      } else {
        await analyzeFileSyncToChat(f, task, assistantMsg);
      }
    } catch (err) {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error: ${err?.message || err}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "file • error");
    } finally {
      fileInput.value = "";
      clearFileBadge();
      taskInput.value = "";
      promptEl.focus();
    }

    return;
  }

  const userText = promptEl.value.trim();
  if (!userText) return;

  const sysText = sysToggle.checked
    ? sysEl.value.trim() || "You are a concise engineering assistant."
    : null;

  if (sysText && messages.length === 0) {
    messages.push({ role: "system", content: sysText });
    createMessage("system", sysText, {
      tag: "session prompt",
      markdown: true,
    });
  }

  createMessage("user", userText, {
    tag: "chat",
    markdown: false,
  });

  messages.push({ role: "user", content: userText });
  promptEl.value = "";
  autoResizeTextarea();

  const options = getGenOptions();

  try {
    if (streamToggle.checked) {
      await askStream(messages, options);
    } else {
      await askSync(messages, options);
    }
  } finally {
    promptEl.focus();
  }
});

async function askSync(msgs, options) {
  const assistantMsg = createMessage("assistant", "Working…", {
    tag: "sync",
    state: "pending",
    markdown: false,
  });

  try {
    const res = await fetch("/api/chat-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, options }),
    });

    if (!res.ok) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error ${res.status}: ${errText}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "sync • error");
      return;
    }

    const data = await res.json();
    const content = data.content || "";

    setBubbleState(assistantMsg.bubble, "done");
    setBubbleContent(assistantMsg.bubble, content, { markdown: true });
    setMessageTag(assistantMsg, "sync");
    appendAssistantMessageToHistory(content);
  } catch (e) {
    setBubbleState(assistantMsg.bubble, "error");
    setBubbleContent(assistantMsg.bubble, `Error: ${e?.message || e}`, {
      markdown: false,
    });
    setMessageTag(assistantMsg, "sync • error");
  }
}

async function askStream(msgs, options) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  const assistantMsg = createMessage("assistant", "", {
    tag: "stream",
    state: "pending",
    markdown: false,
  });

  addTypingIndicator(assistantMsg.bubble);

  let accumulated = "";

  try {
    const res = await fetch("/api/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, options }),
      signal: currentAbort.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        `Error ${res.status || ""}: ${errText || "Request failed"}`,
        { markdown: false },
      );
      setMessageTag(assistantMsg, "stream • error");
      return;
    }

    setBubbleContent(assistantMsg.bubble, "", { markdown: true });

    await streamSSE(res, (payload) => {
      if (payload.done) {
        setBubbleState(assistantMsg.bubble, "done");
        setBubbleContent(assistantMsg.bubble, accumulated, { markdown: true });
        setMessageTag(assistantMsg, "stream");
        appendAssistantMessageToHistory(accumulated);
      } else if (payload.delta) {
        accumulated += payload.delta;
        setBubbleContent(assistantMsg.bubble, accumulated, { markdown: true });
      }
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, accumulated || "Canceled.", {
        markdown: !!accumulated,
      });
      setMessageTag(assistantMsg, "stream • canceled");
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        accumulated || `Error: ${e?.message || e}`,
        { markdown: !!accumulated },
      );
      setMessageTag(assistantMsg, "stream • error");
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function analyzeFileSyncToChat(file, task, assistantMsg) {
  setBubbleState(assistantMsg.bubble, "pending");
  setBubbleContent(assistantMsg.bubble, "Uploading and analyzing…", {
    markdown: false,
  });

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

  try {
    const res = await fetch("/api/analyze-file", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error ${res.status}: ${errText}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "file • sync • error");
      return;
    }

    const j = await res.json();
    const result = j.result || "";

    setBubbleState(assistantMsg.bubble, "done");
    setBubbleContent(assistantMsg.bubble, result, { markdown: true });
    setMessageTag(assistantMsg, "file • sync");
    appendAssistantMessageToHistory(result);
  } catch (e) {
    setBubbleState(assistantMsg.bubble, "error");
    setBubbleContent(assistantMsg.bubble, `Error: ${e?.message || e}`, {
      markdown: false,
    });
    setMessageTag(assistantMsg, "file • sync • error");
  }
}

async function analyzeFileStreamToChat(file, task, assistantMsg) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

  let chunkText = "";
  let finalText = "";

  try {
    const res = await fetch("/api/analyze-file-stream", {
      method: "POST",
      body: form,
      signal: currentAbort.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        `Error ${res.status || ""}: ${errText || "Request failed"}`,
        { markdown: false },
      );
      setMessageTag(assistantMsg, "file • stream • error");
      return;
    }

    setBubbleContent(assistantMsg.bubble, "", { markdown: true });

    await streamSSE(res, (payload) => {
      if (payload.done) {
        const combined = buildFileAnalysisMarkdown(chunkText, finalText);
        setBubbleState(assistantMsg.bubble, "done");
        setBubbleContent(assistantMsg.bubble, combined, { markdown: true });
        setMessageTag(assistantMsg, "file • stream");
        appendAssistantMessageToHistory(combined);
        return;
      }

      if (payload.stage === "chunk") {
        chunkText += `\n\n## Chunk ${payload.index}/${payload.of}\n\n${payload.summary || ""}`;
      } else if (payload.stage === "final") {
        if (payload.delta) {
          finalText += payload.delta;
        } else if (payload.text) {
          finalText = payload.text;
        }
      }

      const combined = buildFileAnalysisMarkdown(chunkText, finalText);
      setBubbleContent(assistantMsg.bubble, combined || "Working…", {
        markdown: true,
      });
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      const combined =
        buildFileAnalysisMarkdown(chunkText, finalText) || "Canceled.";
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, combined, {
        markdown: combined !== "Canceled.",
      });
      setMessageTag(assistantMsg, "file • stream • canceled");
    } else {
      const fallback = buildFileAnalysisMarkdown(chunkText, finalText);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        fallback || `Error: ${e?.message || e}`,
        { markdown: !!fallback },
      );
      setMessageTag(assistantMsg, "file • stream • error");
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

function buildFileAnalysisMarkdown(chunkText, finalText) {
  let out = "";

  if (chunkText.trim()) {
    out += `# Chunk summaries\n${chunkText.trim()}`;
  }

  if (finalText.trim()) {
    out += `${out ? "\n\n---\n\n" : ""}# Final synthesis\n\n${finalText.trim()}`;
  }

  return out.trim();
}

async function streamSSE(res, onMessage) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = raw
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));

        if (!dataLines.length) continue;

        const joined = dataLines.join("\n");

        try {
          const payload = JSON.parse(joined);
          onMessage(payload);
          scrollChatToBottom();
        } catch {
          //
        }
      }
    }

    if (buffer.trim()) {
      const dataLines = buffer
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length) {
        try {
          const payload = JSON.parse(dataLines.join("\n"));
          onMessage(payload);
          scrollChatToBottom();
        } catch {
          //
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

async function safeReadError(res) {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return json.error || json.message || JSON.stringify(json);
    }
    const text = await res.text();
    return text || "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function autoResizeTextarea() {
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 240) + "px";
}

promptEl.addEventListener("input", autoResizeTextarea);

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
