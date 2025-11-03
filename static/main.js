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

let messages = [];
let currentAbort = null;

function addBubble(role, text) {
  const item = document.createElement("div");
  item.className = `bubble ${role}`;
  item.textContent = text;
  chatEl.appendChild(item);
  chatEl.scrollTop = chatEl.scrollHeight;
  return item;
}

function getGenOptions() {
  return {
    temperature: parseFloat(tempEl.value || "0.2"),
    num_predict: parseInt(numPredictEl.value || "512", 10),
    num_ctx: parseInt(numCtxEl.value || "8192", 10),
  };
}

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
    addBubble("user", announce);

    const assistantBubble = addBubble("assistant", "");
    try {
      if (fileStreamToggle.checked) {
        await analyzeFileStreamToChat(f, task, assistantBubble);
      } else {
        await analyzeFileSyncToChat(f, task, assistantBubble);
      }
    } catch (err) {
      assistantBubble.textContent = `Error: ${err?.message || err}`;
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
  }

  addBubble("user", userText);
  messages.push({ role: "user", content: userText });
  promptEl.value = "";

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
  const assistantBubble = addBubble("assistant", "…");
  try {
    const res = await fetch("/api/chat-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, options }),
    });
    if (!res.ok) {
      assistantBubble.textContent = `Error: ${res.status}`;
      return;
    }
    const data = await res.json();
    assistantBubble.textContent = data.content || "";
    messages.push({ role: "assistant", content: data.content || "" });
  } catch (e) {
    assistantBubble.textContent = `Error: ${e?.message || e}`;
  }
}

function setStreamingUI(isStreaming) {
  document.getElementById("sendBtn").disabled = isStreaming;
  document.getElementById("stopBtn").hidden = !isStreaming;
  composer.classList.toggle("busy", isStreaming);
}

document.getElementById("stopBtn").addEventListener("click", () => {
  if (currentAbort) currentAbort.abort();
});

async function askStream(msgs, options) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  const assistantBubble = addBubble("assistant", "");

  let res;
  try {
    res = await fetch("/api/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, options }),
      signal: currentAbort.signal,
    });
  } catch (e) {
    assistantBubble.textContent =
      e?.name === "AbortError" ? "Canceled." : `Error: ${e?.message || e}`;
    return;
  } finally {
  }

  if (!res.ok || !res.body) {
    assistantBubble.textContent = `Error: ${res.status || "Request failed"}`;
    return;
  }

  try {
    await streamSSE(res, (payload) => {
      if (payload.done) {
        messages.push({
          role: "assistant",
          content: assistantBubble.textContent,
        });
      } else if (payload.delta) {
        assistantBubble.textContent += payload.delta;
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      if (!assistantBubble.textContent)
        assistantBubble.textContent = "Canceled.";
    } else {
      if (!assistantBubble.textContent)
        assistantBubble.textContent = `Error: ${e?.message || e}`;
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function analyzeFileSyncToChat(file, task, assistantBubble) {
  assistantBubble.textContent = "Uploading and analyzing (sync)…";
  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

  try {
    const res = await fetch("/api/analyze-file", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      assistantBubble.textContent = `Error: ${res.status}`;
      return;
    }

    const j = await res.json();
    assistantBubble.textContent = j.result || "";
    messages.push({ role: "assistant", content: j.result || "" });
  } catch (e) {
    assistantBubble.textContent = `Error: ${e?.message || e}`;
  }
}

async function analyzeFileStreamToChat(file, task, assistantBubble) {
  setStreamingUI(true);
  currentAbort = new AbortController();

  assistantBubble.textContent = "Uploading and analyzing (stream)…";

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

  let res;
  try {
    res = await fetch("/api/analyze-file-stream", {
      method: "POST",
      body: form,
      signal: currentAbort.signal,
    });
  } catch (e) {
    assistantBubble.textContent =
      e?.name === "AbortError" ? "Canceled." : `Error: ${e?.message || e}`;
    setStreamingUI(false);
    currentAbort = null;
    return;
  }

  if (!res.ok || !res.body) {
    assistantBubble.textContent = `Error: ${res.status || "Request failed"}`;
    setStreamingUI(false);
    currentAbort = null;
    return;
  }

  let startedFinal = false;
  let finalText = "";

  try {
    await streamSSE(res, (payload) => {
      if (payload.done) {
        messages.push({
          role: "assistant",
          content: assistantBubble.textContent,
        });
      } else if (payload.stage === "chunk") {
        const header = `\n\n— Chunk ${payload.index}/${payload.of} —\n`;
        assistantBubble.textContent += header + (payload.summary || "");
      } else if (payload.stage === "final") {
        startedFinal = true;
        if (payload.delta) {
          finalText += payload.delta;
          assistantBubble.textContent += payload.delta;
        } else if (payload.text) {
          assistantBubble.textContent += `\n\nFinal synthesis:\n${payload.text}`;
        }
      }
      chatEl.scrollTop = chatEl.scrollHeight;
    });

    if (
      startedFinal &&
      finalText &&
      !assistantBubble.textContent.includes("Final synthesis:")
    ) {
      assistantBubble.textContent += `\n\nFinal synthesis:\n${finalText}`;
    }
  } catch (e) {
    if (e?.name === "AbortError") {
      if (!assistantBubble.textContent)
        assistantBubble.textContent = "Canceled.";
    } else {
      if (!assistantBubble.textContent)
        assistantBubble.textContent = `Error: ${e?.message || e}`;
    }
  } finally {
    setStreamingUI(false);
    currentAbort = null;
  }
}

async function streamSSE(res, onMessage) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = raw
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6));

        if (!dataLines.length) continue;

        const joined = dataLines.join("");
        try {
          const payload = JSON.parse(joined);
          onMessage(payload);
        } catch {}
      }
    }
  } catch (e) {
    throw e;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

promptEl.addEventListener("input", () => {
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 240) + "px";
});
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
