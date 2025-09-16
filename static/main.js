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

  if (streamToggle.checked) {
    await askStream(messages, options);
  } else {
    await askSync(messages, options);
  }
});

async function askSync(msgs, options) {
  const assistantBubble = addBubble("assistant", "…");
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
}

async function askStream(msgs, options) {
  const assistantBubble = addBubble("assistant", "");
  const res = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs, options }),
  });

  if (!res.ok || !res.body) {
    assistantBubble.textContent = `Error: ${res.status}`;
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data: ")) continue;

      try {
        const payload = JSON.parse(chunk.slice(6));
        if (payload.done) {
          messages.push({
            role: "assistant",
            content: assistantBubble.textContent,
          });
        } else if (payload.delta) {
          assistantBubble.textContent += payload.delta;
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      } catch (_) {}
    }
  }
}

async function analyzeFileSyncToChat(file, task, assistantBubble) {
  assistantBubble.textContent = "Uploading and analyzing (sync)…";
  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

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
}

async function analyzeFileStreamToChat(file, task, assistantBubble) {
  assistantBubble.textContent = "Uploading and analyzing (stream)…";

  const form = new FormData();
  form.append("file", file);
  if (task) form.append("task", task);

  const res = await fetch("/api/analyze-file-stream", {
    method: "POST",
    body: form,
  });

  if (!res.ok || !res.body) {
    assistantBubble.textContent = `Error: ${res.status}`;
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let startedFinal = false;
  let finalText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data: ")) continue;

      try {
        const payload = JSON.parse(chunk.slice(6));

        if (payload.done) {
          messages.push({
            role: "assistant",
            content: assistantBubble.textContent,
          });
        } else if (payload.stage === "chunk") {
          const header = `\n\n— Chunk ${payload.index}/${payload.of} —\n`;
          assistantBubble.textContent += header + (payload.summary || "");
          chatEl.scrollTop = chatEl.scrollHeight;
        } else if (payload.stage === "final") {
          startedFinal = true;
          if (payload.delta) {
            finalText += payload.delta;
            assistantBubble.textContent += payload.delta;
          } else if (payload.text) {
            assistantBubble.textContent += `\n\nFinal synthesis:\n${payload.text}`;
          }
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      } catch (_) {}
    }
  }

  if (
    startedFinal &&
    finalText &&
    !assistantBubble.textContent.includes("Final synthesis:")
  ) {
  }
}
