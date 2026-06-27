const chatEl = document.getElementById("chat");
const composer = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sysEl = document.getElementById("system");
const streamToggle = document.getElementById("streamToggle");
const sysToggle = document.getElementById("sysToggle");
const modelEl = document.getElementById("modelSelect");
const tempEl = document.getElementById("temp");
const numPredictEl = document.getElementById("numPredict");
const numCtxEl = document.getElementById("numCtx");

const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachVideoBtn = document.getElementById("attachVideoBtn");
const videoInput = document.getElementById("videoInput");
const fileBadge = document.getElementById("fileBadge");
const clearFileBtn = document.getElementById("clearFileBtn");
const taskInput = document.getElementById("taskInput");
const framesInput = document.getElementById("framesInput");
const fileStreamToggle = document.getElementById("fileStreamToggle");

const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");

const themeToggle = document.getElementById("themeToggle");
const newChatBtn = document.getElementById("newChatBtn");
const scrollBottomBtn = document.getElementById("scrollBottomBtn");
const dropOverlay = document.getElementById("dropOverlay");

const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];
const TXT_EXTS = [".txt"];

let messages = [];
let currentAbort = null;

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.setAttribute(
    "data-theme",
    isLight ? "light" : "dark",
  );

  const icon = themeToggle.querySelector(".theme-toggle-icon");
  const label = themeToggle.querySelector(".theme-toggle-label");
  if (icon) icon.textContent = isLight ? "☀️" : "🌙";
  if (label) label.textContent = isLight ? "Light" : "Dark";
  themeToggle.setAttribute("aria-pressed", String(isLight));
}

applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

themeToggle.addEventListener("click", () => {
  const next =
    document.documentElement.getAttribute("data-theme") === "light"
      ? "dark"
      : "light";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {}
});

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use(markedFootnote());

function ensureSeparatorBreaks(markdown) {
  const lines = (markdown || "").split("\n");
  const out = [];
  let inFence = false;
  let fenceChar = "";
  const isDashRule = (line) => /^ {0,3}-{3,}\s*$/.test(line);
  for (const line of lines) {
    const fence = line.match(/^ {0,3}(`|~){3,}/);
    if (fence) {
      const ch = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      out.push(line);
      continue;
    }
    if (!inFence && isDashRule(line)) {
      const prev = out.length ? out[out.length - 1] : "";
      if (prev.trim() !== "") out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

marked.use({ hooks: { preprocess: ensureSeparatorBreaks } });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  const href = node.getAttribute("href") || "";
  if (/^https?:\/\//i.test(href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function renderMarkdown(md = "") {
  const rawHtml = marked.parse(md || "");
  return DOMPurify.sanitize(rawHtml);
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

  clearEmptyState();
  chatEl.appendChild(wrapper);

  setBubbleContent(bubble, text, { markdown });
  scrollChatToBottom(true);

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

function isNearBottom(threshold = 80) {
  return (
    chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight <= threshold
  );
}

function scrollChatToBottom(force = false) {
  if (force || isNearBottom()) {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  updateScrollButton();
}

function updateScrollButton() {
  scrollBottomBtn.hidden = isNearBottom();
}

chatEl.addEventListener("scroll", updateScrollButton);

scrollBottomBtn.addEventListener("click", () => {
  chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: "smooth" });
  scrollBottomBtn.hidden = true;
});

const EMPTY_STATE_HTML = `
  <div class="empty-state">
    <div class="empty-hero">
      <div class="empty-badge" aria-hidden="true">💬</div>
      <h2>How can I help?</h2>
      <p>Chat with your local model, or bring in a document or video to analyze — everything runs through your own Ollama instance. You can also drag &amp; drop a file anywhere.</p>
    </div>

    <div class="empty-cards">
      <button type="button" class="empty-card" data-action="chat">
        <span class="empty-card-icon" aria-hidden="true">💬</span>
        <span class="empty-card-title">Ask anything</span>
        <span class="empty-card-desc">Start a conversation with the model.</span>
      </button>
      <button type="button" class="empty-card" data-action="txt">
        <span class="empty-card-icon" aria-hidden="true">📄</span>
        <span class="empty-card-title">Analyze a document</span>
        <span class="empty-card-desc">Summarize or extract from a .txt file.</span>
      </button>
      <button type="button" class="empty-card" data-action="video">
        <span class="empty-card-icon" aria-hidden="true">🎬</span>
        <span class="empty-card-title">Analyze a video</span>
        <span class="empty-card-desc">Describe what happens across the frames.</span>
      </button>
    </div>

    <div class="empty-suggestions">
      <span class="empty-sug-label">Try</span>
      <button type="button" class="empty-chip" data-prompt="Explain like I'm five: ">Explain something simply</button>
      <button type="button" class="empty-chip" data-prompt="Summarize the following text: ">Summarize text</button>
      <button type="button" class="empty-chip" data-prompt="Write a short Python function that ">Write a code snippet</button>
    </div>
  </div>
`;

function renderEmptyState() {
  if (chatEl.querySelector(".message")) return;
  chatEl.innerHTML = EMPTY_STATE_HTML;

  const es = chatEl.querySelector(".empty-state");
  if (!es) return;

  es.addEventListener("click", (e) => {
    const card = e.target.closest("[data-action]");
    if (card) {
      const action = card.dataset.action;
      if (action === "txt") attachBtn.click();
      else if (action === "video") attachVideoBtn.click();
      else promptEl.focus();
      return;
    }

    const chip = e.target.closest("[data-prompt]");
    if (chip) {
      promptEl.value = chip.dataset.prompt;
      autoResizeTextarea();
      promptEl.focus();
    }
  });
}

function clearEmptyState() {
  const es = chatEl.querySelector(".empty-state");
  if (es) es.remove();
}

function makeCopyButton(getText, label = "Copy") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText() || "");
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Failed";
    }
    setTimeout(() => {
      btn.textContent = label;
    }, 1500);
  });
  return btn;
}

function enhanceCodeBlocks(bubble) {
  bubble.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced) return;
    pre.dataset.enhanced = "1";

    const langMatch = (code.className || "").match(/language-([\w+-]+)/i);
    const lang = langMatch ? langMatch[1] : "";

    if (window.hljs) {
      try {
        hljs.highlightElement(code);
      } catch {}
    }

    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.parentNode.insertBefore(wrap, pre);

    const head = document.createElement("div");
    head.className = "code-head";

    const label = document.createElement("span");
    label.className = "code-lang";
    label.textContent = lang || "code";

    head.appendChild(label);
    head.appendChild(makeCopyButton(() => code.textContent));

    wrap.appendChild(head);
    wrap.appendChild(pre);
  });
}

function finalizeAssistantMessage(messageObj, rawText) {
  enhanceCodeBlocks(messageObj.bubble);
  if (
    rawText &&
    rawText.trim() &&
    !messageObj.meta.querySelector(".meta-copy")
  ) {
    const btn = makeCopyButton(() => rawText);
    btn.classList.add("meta-copy");
    messageObj.meta.appendChild(btn);
  }
}

function conversationStarted() {
  return messages.length > 0;
}

function updateSystemPromptAvailability() {
  const started = conversationStarted();
  const lockMsg =
    "System prompt applies to a new conversation. Start a new chat to change it.";
  sysToggle.disabled = started;
  sysEl.disabled = started;
  const labelEl = sysToggle.closest("label");
  if (labelEl) labelEl.title = started ? lockMsg : "";
  sysEl.title = started ? lockMsg : "";
}

function startNewChat() {
  if (currentAbort) currentAbort.abort();
  messages = [];
  chatEl.innerHTML = "";
  renderEmptyState();
  updateSystemPromptAvailability();
  scrollBottomBtn.hidden = true;
  promptEl.focus();
}

newChatBtn.addEventListener("click", startNewChat);

let dragHideTimer = null;

function hideDropOverlay() {
  clearTimeout(dragHideTimer);
  dragHideTimer = null;
  dropOverlay.hidden = true;
}

function dropHasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

function setInputFile(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

function hasExt(name, exts) {
  const lower = (name || "").toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function flashBadge(text) {
  fileBadge.hidden = false;
  fileBadge.textContent = text;
  fileBadge.classList.add("warn");
  clearFileBtn.hidden = true;
  setTimeout(() => {
    if (fileBadge.classList.contains("warn")) clearFileBadge();
  }, 2200);
}

function acceptDroppedFile(file) {
  if (hasExt(file.name, VIDEO_EXTS)) {
    fileInput.value = "";
    setInputFile(videoInput, file);
    showFileBadge(file.name);
  } else if (hasExt(file.name, TXT_EXTS)) {
    videoInput.value = "";
    setInputFile(fileInput, file);
    showFileBadge(file.name);
  } else {
    flashBadge("Unsupported file type");
    return;
  }
  promptEl.focus();
}

window.addEventListener("dragover", (e) => {
  if (!dropHasFiles(e) || sendBtn.disabled) return;
  e.preventDefault();
  dropOverlay.hidden = false;
  clearTimeout(dragHideTimer);
  dragHideTimer = setTimeout(hideDropOverlay, 120);
});

window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) hideDropOverlay();
});

window.addEventListener("drop", (e) => {
  hideDropOverlay();
  if (!dropHasFiles(e)) return;
  e.preventDefault();
  if (sendBtn.disabled) return;
  const file = e.dataTransfer.files?.[0];
  if (file) acceptDroppedFile(file);
});

function appendAssistantMessageToHistory(content) {
  messages.push({ role: "assistant", content });
}

function getGenOptions() {
  const numPredict = parseInt(numPredictEl.value, 10);
  return {
    temperature: parseFloat(tempEl.value || "0.2"),
    num_predict: Number.isNaN(numPredict) ? -1 : numPredict,
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
  modelEl.disabled = isStreaming;
  tempEl.disabled = isStreaming;
  numPredictEl.disabled = isStreaming;
  numCtxEl.disabled = isStreaming;

  attachBtn.disabled = isStreaming;
  fileInput.disabled = isStreaming;
  attachVideoBtn.disabled = isStreaming;
  videoInput.disabled = isStreaming;
  taskInput.disabled = isStreaming;
  framesInput.disabled = isStreaming;
  fileStreamToggle.disabled = isStreaming;
  clearFileBtn.disabled = isStreaming;

  if (!isStreaming) updateSystemPromptAvailability();
}

stopBtn.addEventListener("click", () => {
  if (currentAbort) currentAbort.abort();
});

attachBtn.addEventListener("click", () => fileInput.click());
attachVideoBtn.addEventListener("click", () => videoInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) {
    videoInput.value = "";
    showFileBadge(f.name);
  } else {
    clearFileBadge();
  }
});

videoInput.addEventListener("change", () => {
  const f = videoInput.files?.[0];
  if (f) {
    fileInput.value = "";
    showFileBadge(f.name);
  } else {
    clearFileBadge();
  }
});

clearFileBtn.addEventListener("click", () => {
  fileInput.value = "";
  videoInput.value = "";
  clearFileBadge();
});

function getSelectedUpload() {
  const video = videoInput.files?.[0];
  if (video) return { file: video, kind: "video" };
  const txt = fileInput.files?.[0];
  if (txt) return { file: txt, kind: "txt" };
  return null;
}

function showFileBadge(name) {
  fileBadge.hidden = false;
  fileBadge.textContent = name;
  fileBadge.classList.remove("warn");
  clearFileBtn.hidden = false;
}

function clearFileBadge() {
  fileBadge.hidden = true;
  fileBadge.textContent = "";
  fileBadge.classList.remove("warn");
  clearFileBtn.hidden = true;
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();

  const selected = getSelectedUpload();
  if (selected) {
    const { file: f, kind } = selected;
    const isVideo = kind === "video";
    const label = isVideo ? "video" : "file";
    const task = [promptEl.value.trim(), taskInput.value.trim()]
      .filter(Boolean)
      .join("\n\n");
    const announce = task
      ? `Analyze: ${f.name} — ${task}`
      : `Analyze: ${f.name}`;

    createMessage("user", announce, {
      tag: label,
      markdown: false,
    });

    const assistantMsg = createMessage("assistant", "", {
      tag: `${label} • ${fileStreamToggle.checked ? "stream" : "sync"}`,
      state: "pending",
      markdown: false,
    });

    addTypingIndicator(assistantMsg.bubble);

    try {
      if (isVideo) {
        if (fileStreamToggle.checked) {
          await analyzeVideoStreamToChat(f, task, assistantMsg);
        } else {
          await analyzeVideoSyncToChat(f, task, assistantMsg);
        }
      } else if (fileStreamToggle.checked) {
        await analyzeFileStreamToChat(f, task, assistantMsg);
      } else {
        await analyzeFileSyncToChat(f, task, assistantMsg);
      }
    } catch (err) {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error: ${err?.message || err}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, `${label} • error`);
    } finally {
      fileInput.value = "";
      videoInput.value = "";
      clearFileBadge();
      taskInput.value = "";
      promptEl.value = "";
      autoResizeTextarea();
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
  setStreamingUI(true);
  currentAbort = new AbortController();

  const assistantMsg = createMessage("assistant", "Working…", {
    tag: "sync",
    state: "pending",
    markdown: false,
  });

  try {
    const res = await fetch("/api/chat-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, options, model: modelEl.value }),
      signal: currentAbort.signal,
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
    finalizeAssistantMessage(assistantMsg, content);
  } catch (e) {
    if (e?.name === "AbortError") {
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, "Canceled.", { markdown: false });
      setMessageTag(assistantMsg, "sync • canceled");
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error: ${e?.message || e}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "sync • error");
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
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
      body: JSON.stringify({ messages: msgs, options, model: modelEl.value }),
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
      if (payload.error) {
        setBubbleState(assistantMsg.bubble, "error");
        setBubbleContent(
          assistantMsg.bubble,
          accumulated
            ? `${accumulated}\n\n_Error: ${payload.error}_`
            : `Error: ${payload.error}`,
          { markdown: !!accumulated },
        );
        setMessageTag(assistantMsg, "stream • error");
      } else if (payload.done) {
        setBubbleState(assistantMsg.bubble, "done");
        setBubbleContent(assistantMsg.bubble, accumulated, { markdown: true });
        setMessageTag(assistantMsg, "stream");
        appendAssistantMessageToHistory(accumulated);
        finalizeAssistantMessage(assistantMsg, accumulated);
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
  setStreamingUI(true);
  currentAbort = new AbortController();

  setBubbleState(assistantMsg.bubble, "pending");
  setBubbleContent(assistantMsg.bubble, "Uploading and analyzing…", {
    markdown: false,
  });

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);
  if (modelEl.value) form.append("model", modelEl.value);

  try {
    const res = await fetch("/api/analyze-file", {
      method: "POST",
      body: form,
      signal: currentAbort.signal,
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
    finalizeAssistantMessage(assistantMsg, result);
  } catch (e) {
    if (e?.name === "AbortError") {
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, "Canceled.", { markdown: false });
      setMessageTag(assistantMsg, "file • sync • canceled");
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error: ${e?.message || e}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "file • sync • error");
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function analyzeFileStreamToChat(file, task, assistantMsg) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);
  if (modelEl.value) form.append("model", modelEl.value);

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
      if (payload.error) {
        const combined = buildFileAnalysisMarkdown(chunkText, finalText);
        setBubbleState(assistantMsg.bubble, "error");
        setBubbleContent(
          assistantMsg.bubble,
          combined
            ? `${combined}\n\n---\n\n_Error: ${payload.error}_`
            : `Error: ${payload.error}`,
          { markdown: !!combined },
        );
        setMessageTag(assistantMsg, "file • stream • error");
        return;
      }

      if (payload.done) {
        const combined = buildFileAnalysisMarkdown(chunkText, finalText);
        setBubbleState(assistantMsg.bubble, "done");
        setBubbleContent(assistantMsg.bubble, combined, { markdown: true });
        setMessageTag(assistantMsg, "file • stream");
        appendAssistantMessageToHistory(combined);
        finalizeAssistantMessage(assistantMsg, combined);
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

async function analyzeVideoSyncToChat(file, task, assistantMsg) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  setBubbleState(assistantMsg.bubble, "pending");
  setBubbleContent(assistantMsg.bubble, "Extracting frames and analyzing…", {
    markdown: false,
  });

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);
  if (modelEl.value) form.append("model", modelEl.value);
  form.append("frames", framesInput.value || "8");

  try {
    const res = await fetch("/api/analyze-video", {
      method: "POST",
      body: form,
      signal: currentAbort.signal,
    });

    if (!res.ok) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error ${res.status}: ${errText}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "video • sync • error");
      return;
    }

    const j = await res.json();
    const result = j.result || "";

    setBubbleState(assistantMsg.bubble, "done");
    setBubbleContent(assistantMsg.bubble, result, { markdown: true });
    setMessageTag(assistantMsg, `video • sync • ${j.frames || 0} frames`);
    appendAssistantMessageToHistory(result);
    finalizeAssistantMessage(assistantMsg, result);
  } catch (e) {
    if (e?.name === "AbortError") {
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, "Canceled.", { markdown: false });
      setMessageTag(assistantMsg, "video • sync • canceled");
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(assistantMsg.bubble, `Error: ${e?.message || e}`, {
        markdown: false,
      });
      setMessageTag(assistantMsg, "video • sync • error");
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function analyzeVideoStreamToChat(file, task, assistantMsg) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);
  if (modelEl.value) form.append("model", modelEl.value);
  form.append("frames", framesInput.value || "8");

  let accumulated = "";
  let frameCount = 0;

  try {
    setBubbleContent(assistantMsg.bubble, "Extracting frames…", {
      markdown: false,
    });

    const res = await fetch("/api/analyze-video-stream", {
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
      setMessageTag(assistantMsg, "video • stream • error");
      return;
    }

    await streamSSE(res, (payload) => {
      if (payload.error) {
        setBubbleState(assistantMsg.bubble, "error");
        setBubbleContent(
          assistantMsg.bubble,
          accumulated
            ? `${accumulated}\n\n_Error: ${payload.error}_`
            : `Error: ${payload.error}`,
          { markdown: !!accumulated },
        );
        setMessageTag(assistantMsg, "video • stream • error");
      } else if (payload.done) {
        setBubbleState(assistantMsg.bubble, "done");
        setBubbleContent(assistantMsg.bubble, accumulated, { markdown: true });
        setMessageTag(assistantMsg, `video • stream • ${frameCount} frames`);
        appendAssistantMessageToHistory(accumulated);
        finalizeAssistantMessage(assistantMsg, accumulated);
      } else if (payload.stage === "frames") {
        frameCount = payload.frames || 0;
        addTypingIndicator(assistantMsg.bubble);
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
      setMessageTag(assistantMsg, "video • stream • canceled");
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        accumulated || `Error: ${e?.message || e}`,
        { markdown: !!accumulated },
      );
      setMessageTag(assistantMsg, "video • stream • error");
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
        } catch {}
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
        } catch {}
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

async function loadModels() {
  const fallback = modelEl.dataset.default || "";
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return;
    const data = await res.json();
    const names = (data.models || [])
      .map((m) => m.name || m.model)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) return;

    const selected = names.includes(fallback) ? fallback : names[0];
    modelEl.innerHTML = "";
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === selected) opt.selected = true;
      modelEl.appendChild(opt);
    }
  } catch {}
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

renderEmptyState();
updateSystemPromptAvailability();
loadModels();
