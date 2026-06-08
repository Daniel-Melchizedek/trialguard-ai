function daysUntil(dateStr) {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  if (isNaN(end.getTime())) return null;
  // Compare at midnight so "June 6" always shows as 2 days away when today is June 4
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown end date";
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

function renderTrial(trial) {
  const days = daysUntil(trial.trialEndDate);
  const card = document.createElement("div");
  card.className = "trial-card";

  let dateClass = "ok", dateLabel = "";
  if (days === null) {
    dateLabel = "End date unknown";
    dateClass = "ok";
  } else if (days < 0) {
    dateLabel = "Trial expired";
    dateClass = "danger";
    card.classList.add("expired");
  } else if (days <= 3) {
    dateLabel = `⚠️ Ends in ${days} day${days !== 1 ? "s" : ""} — cancel now!`;
    dateClass = "warn";
    card.classList.add("expiring-soon");
  } else {
    dateLabel = `Ends in ${days} days (${formatDate(trial.trialEndDate)})`;
    dateClass = "ok";
  }

  card.innerHTML = `
    <div class="trial-name">${trial.productName || "Unknown Product"}</div>
    <div class="trial-meta">${trial.websiteUrl || ""}</div>
    <div class="trial-date ${dateClass}">${dateLabel}</div>
  `;

  const status = trial.cancellationStatus || "none";
  if (status === "completed") {
    const badge = document.createElement("span");
    badge.className = "badge-cancelled";
    badge.textContent = "Cancelled ✓";
    card.appendChild(badge);
  } else if (status === "running" || status === "planning") {
    const badge = document.createElement("span");
    badge.className = "badge-cancelling";
    badge.innerHTML = `<span class="spinner"></span> Cancelling…`;
    card.appendChild(badge);
  } else {
    if (status === "failed" || status === "stopped") {
      const badge = document.createElement("span");
      badge.className = "badge-failed";
      badge.textContent = status === "stopped" ? "Stopped" : "Last attempt failed";
      card.appendChild(badge);
    }
    const btn = document.createElement("button");
    btn.className = "btn-cancel";
    btn.textContent = (status === "failed" || status === "stopped") ? "Retry Cancellation" : "Cancel Trial";
    btn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.storage.session.set({ activeCancellation: { trial, tabId: tab.id } });
      await chrome.sidePanel.open({ windowId: tab.windowId });
      chrome.runtime.sendMessage({ action: "requestCancellation", trial, tabId: tab.id });
      window.close();
    });
    card.appendChild(btn);
  }

  return card;
}

async function checkAionStatus() {
  const statusEl = document.getElementById("ai-status");

  if (typeof LanguageModel === "undefined") {
    statusEl.className = "ai-status error";
    statusEl.innerHTML = "⚠️ LanguageModel API not found. Requires Edge 150+ Canary/Dev with Aion 1.0.";
    statusEl.classList.remove("hidden");
    return;
  }

  // LanguageModel.availability() triggers an uncatchable Edge browser error regardless
  // of options passed. Use create() with expectedOutputLanguages instead — it does not
  // trigger that error and covers all states: resolves instantly if model is ready,
  // fires downloadprogress events if a download is needed, rejects if unavailable.
  const stored = await chrome.storage.local.get(["aionReady", "aionError"]);

  if (stored.aionReady) {
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready — on-device AI active";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 3000);
    return;
  }

  statusEl.className = "ai-status downloading";
  statusEl.innerHTML = `<span class="spinner"></span> Checking Aion 1.0 status…`;
  statusEl.classList.remove("hidden");

  let downloadStarted = false;

  LanguageModel.create({
    expectedOutputLanguages: ["en"],
    monitor(m) {
      m.addEventListener("downloadprogress", e => {
        downloadStarted = true;
        const pct = e.total > 0 ? Math.round((e.loaded / e.total) * 100) : null;
        const pctTxt = pct != null ? `${pct}%` : `${(e.loaded / 1024 / 1024).toFixed(0)} MB`;
        statusEl.innerHTML = `<span class="spinner"></span> Downloading Aion 1.0… ${pctTxt}`;
        chrome.storage.local.set({
          aionProgress: {
            loaded: e.loaded, total: e.total, pct, ts: Date.now()
          }
        });
      });
    }
  }).then(session => {
    session.destroy();
    chrome.storage.local.set({ aionReady: true, aionProgress: null });
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready — on-device AI active";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 3000);
  }).catch(err => {
    console.warn("[TrialGuard] LanguageModel.create() probe failed:", err.message);
    statusEl.className = "ai-status error";
    statusEl.textContent = "⚠️ Aion 1.0 unavailable on this device.";
    statusEl.classList.remove("hidden");
  });
}

checkAionStatus();

const trialList  = document.getElementById("trial-list");
const emptyState = document.getElementById("empty-state");
const noBanner   = document.getElementById("no-email-banner");
const emailRow   = document.getElementById("email-display");
const emailText  = document.getElementById("email-text");

function renderTrialList(trials) {
  trialList.innerHTML = "";
  if (!trials || trials.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
    trials.forEach(t => trialList.appendChild(renderTrial(t)));
  }
}

function loadAndRender() {
  chrome.storage.sync.get(["userEmail", "trials"], data => {
    const email  = data.userEmail;
    const trials = data.trials || [];

    if (!email) {
      noBanner.classList.remove("hidden");
      emailRow.classList.add("hidden");
    } else {
      noBanner.classList.add("hidden");
      emailRow.classList.remove("hidden");
      emailText.textContent = email;
    }

    renderTrialList(trials);
    console.log("[TrialGuard Popup] Loaded", trials.length, "trial(s) from storage");
  });
}

// Initial load
loadAndRender();

// Live update — re-render whenever storage changes (trial detected while popup is open)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.trials) {
    console.log("[TrialGuard Popup] Storage updated — refreshing trial list");
    renderTrialList(changes.trials.newValue || []);
  }
});

document.getElementById("open-options")?.addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById("open-options-link")?.addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
