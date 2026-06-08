let currentTrialId = null;
let lastStepEl = null;

const logEl     = document.getElementById("sp-log");
const titleEl   = document.getElementById("sp-title");
const subtitleEl = document.getElementById("sp-subtitle");
const btnStop   = document.getElementById("btn-stop");
const btnClose  = document.getElementById("btn-close");
const mcpSetup  = document.getElementById("sp-mcp-setup");

function appendToast(type, message) {
  const entry = document.createElement("div");
  entry.className = `toast toast-${type}`;

  const iconEl = document.createElement("span");
  if (type === "step" || type === "planning") {
    iconEl.className = "toast-icon spinning";
  } else {
    const icons = { done: "✓", error: "✗", stopped: "■", info: "●" };
    iconEl.className = "toast-icon";
    iconEl.textContent = icons[type] || "●";
  }

  const msgEl = document.createElement("span");
  msgEl.className = "toast-msg";
  msgEl.textContent = message;

  entry.appendChild(iconEl);
  entry.appendChild(msgEl);
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  return entry;
}

function markStepDone(el) {
  if (!el) return;
  const icon = el.querySelector(".toast-icon");
  if (icon) { icon.className = "toast-icon"; icon.textContent = "✓"; }
  el.classList.remove("toast-step");
  el.classList.add("toast-completed");
}

function markStepError(el) {
  if (!el) return;
  const icon = el.querySelector(".toast-icon");
  if (icon) { icon.className = "toast-icon"; icon.textContent = "✗"; }
  el.classList.remove("toast-step");
  el.classList.add("toast-error");
}

function setTerminalState() {
  btnStop.classList.add("hidden");
  btnClose.classList.remove("hidden");
}

async function init() {
  btnStop.classList.add("hidden");
  btnClose.classList.add("hidden");

  let active = null;
  try {
    const data = await chrome.storage.session.get("activeCancellation");
    active = data.activeCancellation;
  } catch {}

  if (!active?.trial) {
    subtitleEl.textContent = "No active cancellation";
    btnClose.classList.remove("hidden");
    return;
  }

  currentTrialId = active.trial.id;
  titleEl.textContent = `Cancelling ${active.trial.productName}`;
  subtitleEl.textContent = "Starting…";
  btnStop.classList.remove("hidden");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== "spUpdate") return;
  const { type, payload } = message;

  if (payload?.trialId && currentTrialId && payload.trialId !== currentTrialId) return;

  switch (type) {
    case "toast": {
      const entry = appendToast(payload.type, payload.message);
      if (payload.type === "step") lastStepEl = entry;
      break;
    }

    case "step_done":
      markStepDone(lastStepEl);
      break;

    case "step_error":
      markStepError(lastStepEl);
      break;

    case "phase": {
      const { phase, stepCount } = payload;
      if (phase === "planning") {
        subtitleEl.textContent = "Planning…";
      } else if (phase === "running") {
        subtitleEl.textContent = stepCount ? `Running ${stepCount} steps…` : "Running…";
      } else if (phase === "completed") {
        subtitleEl.textContent = "Cancelled ✓";
        setTerminalState();
      } else if (phase === "stopped") {
        subtitleEl.textContent = "Stopped";
        setTerminalState();
      } else if (phase === "failed") {
        subtitleEl.textContent = "Failed";
        setTerminalState();
      }
      break;
    }

    case "mcp_unavailable":
      mcpSetup.classList.remove("hidden");
      subtitleEl.textContent = "MCP server unavailable";
      setTerminalState();
      break;

    case "no_plan": {
      appendToast("error", "Could not determine cancellation steps.");
      if (payload?.websiteUrl) {
        const link = document.createElement("div");
        link.className = "toast toast-link";
        const a = document.createElement("a");
        a.href = payload.websiteUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "fallback-link";
        a.textContent = "Open subscription page →";
        link.appendChild(a);
        logEl.appendChild(link);
        logEl.scrollTop = logEl.scrollHeight;
      }
      subtitleEl.textContent = "No plan found";
      setTerminalState();
      break;
    }
  }
});

btnStop.addEventListener("click", () => {
  if (!currentTrialId) return;
  chrome.runtime.sendMessage({ action: "cancelStop", trialId: currentTrialId });
  btnStop.disabled = true;
  btnStop.textContent = "Stopping…";
});

btnClose.addEventListener("click", () => window.close());

document.getElementById("btn-copy-cmd")?.addEventListener("click", () => {
  navigator.clipboard.writeText("npx @playwright/mcp@latest --port 3333 --extension");
  const btn = document.getElementById("btn-copy-cmd");
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => { btn.textContent = orig; }, 2000);
});

init();
