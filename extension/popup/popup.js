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
      // Side panel triggers requestCancellation itself once its onMessage listener is registered.
      window.close();
    });
    card.appendChild(btn);
  }

  // Dismiss (×) — remove a trial from the list (e.g. a false positive like a free plan).
  const dismiss = document.createElement("button");
  dismiss.className = "btn-dismiss";
  dismiss.title = "Remove this trial";
  dismiss.setAttribute("aria-label", "Remove this trial");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissTrial(trial);
  });
  card.appendChild(dismiss);

  return card;
}

// Remove a trial from storage (by id, falling back to product+url) and re-render.
function dismissTrial(trial) {
  chrome.storage.sync.get(["trials"], data => {
    const trials = (data.trials || []).filter(t =>
      trial.id ? t.id !== trial.id
               : !(t.productName === trial.productName && t.websiteUrl === trial.websiteUrl)
    );
    chrome.storage.sync.set({ trials }, () => {
      console.log("[TrialGuard Popup] Dismissed trial:", trial.productName);
      renderTrialList(trials);
    });
  });
}

async function checkAionStatus() {
  const statusEl = document.getElementById("ai-status");
  if (typeof LanguageModel === "undefined") {
    statusEl.className = "ai-status error";
    statusEl.textContent = "⚠️ Requires Edge with Aion 1.0 enabled.";
    statusEl.classList.remove("hidden");
    return;
  }
  const { aionReady } = await chrome.storage.local.get(["aionReady"]);
  if (aionReady) {
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 2000);
  }
  // Not ready yet — agent initialises on demand when Cancel Trial is clicked
}

setTimeout(checkAionStatus, 0);

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
