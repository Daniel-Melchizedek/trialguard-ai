let currentTrialId = null;
let lastStepEl = null;

const logEl     = document.getElementById("sp-log");
const titleEl   = document.getElementById("sp-title");
const subtitleEl = document.getElementById("sp-subtitle");
const timerEl   = document.getElementById("sp-timer");
const btnStop   = document.getElementById("btn-stop");
const btnClose  = document.getElementById("btn-close");
const aionSetup = document.getElementById("sp-aion-setup");

// ─── Header elapsed-time timer ────────────────────────────────────────────────
let timerInterval = null, timerStart = 0;
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function startTimer() {
  if (timerInterval) return;
  timerStart = Date.now();
  timerEl.textContent = "0:00";
  timerEl.classList.remove("hidden");
  timerEl.classList.add("running");
  timerInterval = setInterval(() => {
    timerEl.textContent = fmtElapsed(Date.now() - timerStart);
  }, 1000);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerEl.classList.remove("running");   // freeze at final value, switch to muted colour
}

function appendToast(type, message) {
  const entry = document.createElement("div");
  entry.className = `toast toast-${type}`;

  const iconEl = document.createElement("span");
  if (type === "step" || type === "planning") {
    iconEl.className = "toast-icon spinning";
  } else {
    const icons = { done: "✓", error: "✗", stopped: "■", info: "●",
                    select: "🔍", context: "📄", confirm: "✓", reconsider: "↻", password: "🔒", prompt: "🧠" };
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
  stopTimer();   // freeze the header timer on any terminal outcome (done/stopped/failed/no-plan/aion-unavailable)
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
  startTimer();   // begin the header elapsed-time timer



  // Listener is now registered — safe to ask background to start the agent.
  chrome.runtime.sendMessage({
    action: "requestCancellation",
    trial: active.trial,
    tabId: active.tabId
  });
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
      const { phase } = payload;
      if (phase === "running") {
        subtitleEl.textContent = "Running…";
      } else if (phase === "awaiting_password") {
        subtitleEl.textContent = "🔒 Waiting for your password…";
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

    case "aion_unavailable":
      aionSetup?.classList.remove("hidden");
      subtitleEl.textContent = "Aion unavailable";
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


init();
