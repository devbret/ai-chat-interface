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
const historyBtn = document.getElementById("historyBtn");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const historyCloseBtn = document.getElementById("historyCloseBtn");
const historyBackdrop = document.getElementById("historyBackdrop");
const historySearch = document.getElementById("historySearch");
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
  store.activeId = null;
  idbPutActiveId(null);
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

const DB_NAME = "ai-chat-interface";
const DB_VERSION = 1;
const LEGACY_STORE_KEY = "ai-chat-store-v1";
const LEGACY_HISTORY_KEY = "ai-chat-history-v1";

let db = null;
let store = { activeId: null, chats: [] };

function genChatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sanitizeMessages(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (m) =>
      m &&
      typeof m.content === "string" &&
      ["system", "user", "assistant"].includes(m.role),
  );
}

function sanitizeChat(c) {
  const msgs = sanitizeMessages(c?.messages);
  if (!msgs.length) return null;
  return {
    id: String(c.id || genChatId()),
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt || c.createdAt || Date.now(),
    messages: msgs,
  };
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOpen() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains("chats")) {
      d.createObjectStore("chats", { keyPath: "id" });
    }
    if (!d.objectStoreNames.contains("meta")) {
      d.createObjectStore("meta");
    }
  };
  return idbRequest(req);
}

function idbChats(mode) {
  return db.transaction("chats", mode).objectStore("chats");
}

function idbMeta(mode) {
  return db.transaction("meta", mode).objectStore("meta");
}

function warnStorage(e) {
  console.warn("Chat storage write failed:", e);
}

function idbPutChat(chat) {
  if (!db) return;
  idbRequest(idbChats("readwrite").put(chat)).catch(warnStorage);
}

function idbDeleteChat(id) {
  if (!db) return;
  idbRequest(idbChats("readwrite").delete(id)).catch(warnStorage);
}

function idbPutActiveId(id) {
  if (!db) return;
  idbRequest(idbMeta("readwrite").put(id, "activeId")).catch(warnStorage);
}

function readLegacyData() {
  const out = { chats: [], activeId: null };
  try {
    const storeRaw = localStorage.getItem(LEGACY_STORE_KEY);
    if (storeRaw) {
      const parsed = JSON.parse(storeRaw);
      for (const c of Array.isArray(parsed?.chats) ? parsed.chats : []) {
        const chat = sanitizeChat(c);
        if (chat) out.chats.push(chat);
      }
      if (out.chats.some((c) => c.id === parsed?.activeId)) {
        out.activeId = parsed.activeId;
      }
    }
    const historyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (historyRaw) {
      const msgs = sanitizeMessages(JSON.parse(historyRaw));
      if (msgs.length) {
        const chat = {
          id: genChatId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: msgs,
        };
        out.chats.push(chat);
        if (!out.activeId) out.activeId = chat.id;
      }
    }
  } catch (e) {}
  return out;
}

async function initStore() {
  db = await idbOpen();
  const [rawChats, savedActiveId] = await Promise.all([
    idbRequest(idbChats("readonly").getAll()),
    idbRequest(idbMeta("readonly").get("activeId")),
  ]);
  store.chats = (rawChats || []).map(sanitizeChat).filter(Boolean);
  store.activeId = savedActiveId || null;

  const legacy = readLegacyData();
  if (legacy.chats.length) {
    const known = new Set(store.chats.map((c) => c.id));
    const imported = legacy.chats.filter((c) => !known.has(c.id));
    if (imported.length) {
      const tx = db.transaction("chats", "readwrite");
      for (const c of imported) tx.objectStore("chats").put(c);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      store.chats.push(...imported);
    }
    if (!currentChat() && legacy.activeId) {
      store.activeId = legacy.activeId;
      idbPutActiveId(store.activeId);
    }
  }
  try {
    localStorage.removeItem(LEGACY_STORE_KEY);
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch (e) {}

  if (!currentChat()) store.activeId = null;
}

function currentChat() {
  return store.chats.find((c) => c.id === store.activeId) || null;
}

function saveChat() {
  let chat = currentChat();
  if (!chat) {
    if (!messages.length) return;
    chat = {
      id: genChatId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    store.chats.push(chat);
    store.activeId = chat.id;
    idbPutActiveId(chat.id);
  }
  chat.messages = messages;
  chat.updatedAt = Date.now();
  idbPutChat(chat);
}

function pushMessage(msg) {
  messages.push({ ...msg, time: formatTime() });
  saveChat();
}

function apiMessages() {
  return messages.map(({ role, content }) => ({ role, content }));
}

function appendAssistantMessageToHistory(content) {
  pushMessage({ role: "assistant", content });
}

function renderConversation(msgs) {
  chatEl.innerHTML = "";
  for (const m of msgs) {
    if (m.role === "system") {
      createMessage("system", m.content, {
        tag: "session prompt",
        markdown: true,
        time: m.time,
      });
    } else if (m.role === "user") {
      createMessage("user", m.content, { tag: "chat", time: m.time });
    } else {
      const msgObj = createMessage("assistant", m.content, {
        state: "done",
        markdown: true,
        time: m.time,
      });
      finalizeAssistantMessage(msgObj, m.content);
    }
  }
}

function chatTitle(chat) {
  const firstUser = chat.messages.find((m) => m.role === "user");
  const text = (firstUser?.content || "Untitled chat")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

function formatChatDate(ts) {
  const d = new Date(ts);
  const isToday = new Date().toDateString() === d.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function searchChat(chat, q) {
  let count = 0;
  let firstIndex = -1;
  chat.messages.forEach((m, i) => {
    if (m.content.toLowerCase().includes(q)) {
      count++;
      if (firstIndex === -1) firstIndex = i;
    }
  });
  return count ? { count, firstIndex } : null;
}

function buildSnippet(content, q) {
  const idx = content.toLowerCase().indexOf(q);
  const start = Math.max(0, idx - 32);
  const end = Math.min(content.length, idx + q.length + 64);

  const frag = document.createDocumentFragment();
  if (start > 0) frag.appendChild(document.createTextNode("…"));
  frag.appendChild(document.createTextNode(content.slice(start, idx)));
  const mark = document.createElement("mark");
  mark.textContent = content.slice(idx, idx + q.length);
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(content.slice(idx + q.length, end)));
  if (end < content.length) frag.appendChild(document.createTextNode("…"));
  return frag;
}

function renderChatList(query = "") {
  historyList.innerHTML = "";
  const q = query.trim().toLowerCase();
  const chats = [...store.chats].sort((a, b) => b.updatedAt - a.updatedAt);

  const rows = [];
  for (const chat of chats) {
    if (!q) {
      rows.push({ chat, hit: null });
      continue;
    }
    const hit = searchChat(chat, q);
    if (hit) rows.push({ chat, hit });
  }

  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = q
      ? `No chats match “${query.trim()}”.`
      : "No previous chats yet.";
    historyList.appendChild(empty);
    return;
  }

  for (const { chat, hit } of rows) {
    const li = document.createElement("li");
    li.className =
      "history-item" + (chat.id === store.activeId ? " active" : "");

    const load = document.createElement("button");
    load.type = "button";
    load.className = "history-load";

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = chatTitle(chat);

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const n = chat.messages.length;
    meta.textContent = hit
      ? `${hit.count} matching message${hit.count === 1 ? "" : "s"} · ${formatChatDate(chat.updatedAt)}`
      : `${n} message${n === 1 ? "" : "s"} · ${formatChatDate(chat.updatedAt)}`;

    load.appendChild(title);
    load.appendChild(meta);

    if (hit) {
      const snippet = document.createElement("span");
      snippet.className = "history-snippet";
      snippet.appendChild(
        buildSnippet(chat.messages[hit.firstIndex].content, q),
      );
      load.appendChild(snippet);
    }

    load.addEventListener("click", () => {
      loadChat(chat.id, hit ? hit.firstIndex : null);
      closeHistory();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "history-delete";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete chat: ${chatTitle(chat)}`);
    del.addEventListener("click", () => deleteChat(chat.id));

    li.appendChild(load);
    li.appendChild(del);
    historyList.appendChild(li);
  }
}

function loadChat(id, focusIndex = null) {
  const chat = store.chats.find((c) => c.id === id);
  if (!chat) return;
  if (currentAbort) currentAbort.abort();
  store.activeId = id;
  messages = chat.messages;
  renderConversation(messages);
  idbPutActiveId(id);
  updateSystemPromptAvailability();
  if (focusIndex != null) {
    const target = chatEl.querySelectorAll(".message")[focusIndex];
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("search-hit");
    }
  }
  promptEl.focus();
}

function deleteChat(id) {
  const wasActive = id === store.activeId;
  store.chats = store.chats.filter((c) => c.id !== id);
  if (wasActive) store.activeId = null;
  idbDeleteChat(id);
  renderChatList(historySearch.value);
  if (wasActive) startNewChat();
}

function openHistory() {
  historySearch.value = "";
  renderChatList();
  historyPanel.hidden = false;
  historyBackdrop.hidden = false;
  historySearch.focus();
}

function closeHistory() {
  historyPanel.hidden = true;
  historyBackdrop.hidden = true;
}

historyBtn.addEventListener("click", () => {
  if (historyPanel.hidden) openHistory();
  else closeHistory();
});
historyCloseBtn.addEventListener("click", closeHistory);
historyBackdrop.addEventListener("click", closeHistory);

historySearch.addEventListener("input", () => {
  renderChatList(historySearch.value);
});

historySearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && historySearch.value) {
    e.stopPropagation();
    historySearch.value = "";
    renderChatList();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !historyPanel.hidden) closeHistory();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (historyPanel.hidden) openHistory();
    else closeHistory();
  }
});

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

    pushMessage({
      role: "user",
      content: task
        ? `I uploaded a ${label} named "${f.name}" and asked: ${task}`
        : `I uploaded a ${label} named "${f.name}" for analysis.`,
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
    pushMessage({ role: "system", content: sysText });
    createMessage("system", sysText, {
      tag: "session prompt",
      markdown: true,
    });
  }

  createMessage("user", userText, {
    tag: "chat",
    markdown: false,
  });

  pushMessage({ role: "user", content: userText });
  promptEl.value = "";
  autoResizeTextarea();

  const options = getGenOptions();

  try {
    if (streamToggle.checked) {
      await askStream(apiMessages(), options);
    } else {
      await askSync(apiMessages(), options);
    }
  } finally {
    promptEl.focus();
  }
});

function analysisForm(file, task, frames) {
  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);
  if (modelEl.value) form.append("model", modelEl.value);
  if (frames != null) form.append("frames", frames);
  return form;
}

function completeAssistantMessage(assistantMsg, tag, content) {
  setBubbleState(assistantMsg.bubble, "done");
  setBubbleContent(assistantMsg.bubble, content, { markdown: true });
  setMessageTag(assistantMsg, tag);
  appendAssistantMessageToHistory(content);
  finalizeAssistantMessage(assistantMsg, content);
}

function showStreamError(assistantMsg, tagPrefix, errText, partial) {
  setBubbleState(assistantMsg.bubble, "error");
  setBubbleContent(
    assistantMsg.bubble,
    partial ? `${partial}\n\n_Error: ${errText}_` : `Error: ${errText}`,
    { markdown: !!partial },
  );
  setMessageTag(assistantMsg, `${tagPrefix} • error`);
}

async function runAssistantRequest(assistantMsg, tagPrefix, req, handler) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.json ? { "Content-Type": "application/json" } : undefined,
      body: req.json ? JSON.stringify(req.json) : req.body,
      signal: currentAbort.signal,
    });

    if (!res.ok || (req.sse && !res.body)) {
      const errText = await safeReadError(res);
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        `Error ${res.status || ""}: ${errText || "Request failed"}`,
        { markdown: false },
      );
      setMessageTag(assistantMsg, `${tagPrefix} • error`);
      return;
    }

    await handler(res);
  } catch (e) {
    const partial = (req.getPartial && req.getPartial()) || "";
    if (e?.name === "AbortError") {
      setBubbleState(assistantMsg.bubble, "canceled");
      setBubbleContent(assistantMsg.bubble, partial || "Canceled.", {
        markdown: !!partial,
      });
      setMessageTag(assistantMsg, `${tagPrefix} • canceled`);
    } else {
      setBubbleState(assistantMsg.bubble, "error");
      setBubbleContent(
        assistantMsg.bubble,
        partial || `Error: ${e?.message || e}`,
        { markdown: !!partial },
      );
      setMessageTag(assistantMsg, `${tagPrefix} • error`);
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function askSync(msgs, options) {
  const assistantMsg = createMessage("assistant", "Working…", {
    tag: "sync",
    state: "pending",
    markdown: false,
  });

  await runAssistantRequest(
    assistantMsg,
    "sync",
    {
      url: "/api/chat-sync",
      json: { messages: msgs, options, model: modelEl.value },
    },
    async (res) => {
      const data = await res.json();
      completeAssistantMessage(assistantMsg, "sync", data.content || "");
    },
  );
}

async function askStream(msgs, options) {
  const assistantMsg = createMessage("assistant", "", {
    tag: "stream",
    state: "pending",
    markdown: false,
  });

  addTypingIndicator(assistantMsg.bubble);

  let accumulated = "";

  await runAssistantRequest(
    assistantMsg,
    "stream",
    {
      url: "/api/chat-stream",
      json: { messages: msgs, options, model: modelEl.value },
      sse: true,
      getPartial: () => accumulated,
    },
    async (res) => {
      setBubbleContent(assistantMsg.bubble, "", { markdown: true });

      await streamSSE(res, (payload) => {
        if (payload.error) {
          showStreamError(assistantMsg, "stream", payload.error, accumulated);
        } else if (payload.done) {
          completeAssistantMessage(assistantMsg, "stream", accumulated);
        } else if (payload.delta) {
          accumulated += payload.delta;
          setBubbleContent(assistantMsg.bubble, accumulated, {
            markdown: true,
          });
        }
      });
    },
  );
}

async function analyzeFileSyncToChat(file, task, assistantMsg) {
  setBubbleState(assistantMsg.bubble, "pending");
  setBubbleContent(assistantMsg.bubble, "Uploading and analyzing…", {
    markdown: false,
  });

  await runAssistantRequest(
    assistantMsg,
    "file • sync",
    {
      url: "/api/analyze-file",
      body: analysisForm(file, task),
    },
    async (res) => {
      const j = await res.json();
      completeAssistantMessage(assistantMsg, "file • sync", j.result || "");
    },
  );
}

async function analyzeFileStreamToChat(file, task, assistantMsg) {
  let chunkText = "";
  let finalText = "";
  const partial = () => buildFileAnalysisMarkdown(chunkText, finalText);

  await runAssistantRequest(
    assistantMsg,
    "file • stream",
    {
      url: "/api/analyze-file-stream",
      body: analysisForm(file, task),
      sse: true,
      getPartial: partial,
    },
    async (res) => {
      setBubbleContent(assistantMsg.bubble, "", { markdown: true });

      await streamSSE(res, (payload) => {
        if (payload.error) {
          showStreamError(
            assistantMsg,
            "file • stream",
            payload.error,
            partial(),
          );
          return;
        }

        if (payload.done) {
          completeAssistantMessage(assistantMsg, "file • stream", partial());
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

        setBubbleContent(assistantMsg.bubble, partial() || "Working…", {
          markdown: true,
        });
      });
    },
  );
}

async function analyzeVideoSyncToChat(file, task, assistantMsg) {
  setBubbleState(assistantMsg.bubble, "pending");
  setBubbleContent(assistantMsg.bubble, "Extracting frames and analyzing…", {
    markdown: false,
  });

  await runAssistantRequest(
    assistantMsg,
    "video • sync",
    {
      url: "/api/analyze-video",
      body: analysisForm(file, task, framesInput.value || "8"),
    },
    async (res) => {
      const j = await res.json();
      completeAssistantMessage(
        assistantMsg,
        `video • sync • ${j.frames || 0} frames`,
        j.result || "",
      );
    },
  );
}

async function analyzeVideoStreamToChat(file, task, assistantMsg) {
  let accumulated = "";
  let frameCount = 0;

  setBubbleContent(assistantMsg.bubble, "Extracting frames…", {
    markdown: false,
  });

  await runAssistantRequest(
    assistantMsg,
    "video • stream",
    {
      url: "/api/analyze-video-stream",
      body: analysisForm(file, task, framesInput.value || "8"),
      sse: true,
      getPartial: () => accumulated,
    },
    async (res) => {
      await streamSSE(res, (payload) => {
        if (payload.error) {
          showStreamError(
            assistantMsg,
            "video • stream",
            payload.error,
            accumulated,
          );
        } else if (payload.done) {
          completeAssistantMessage(
            assistantMsg,
            `video • stream • ${frameCount} frames`,
            accumulated,
          );
        } else if (payload.stage === "frames") {
          frameCount = payload.frames || 0;
          addTypingIndicator(assistantMsg.bubble);
        } else if (payload.delta) {
          accumulated += payload.delta;
          setBubbleContent(assistantMsg.bubble, accumulated, {
            markdown: true,
          });
        }
      });
    },
  );
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

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.warn("IndexedDB unavailable; chats will not persist.", e);
  }
  const activeChatOnLoad = currentChat();
  if (activeChatOnLoad) {
    messages = activeChatOnLoad.messages;
    renderConversation(messages);
  } else {
    renderEmptyState();
  }
  updateSystemPromptAvailability();
  loadModels();
})();
