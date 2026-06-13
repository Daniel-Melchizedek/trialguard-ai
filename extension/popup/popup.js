// Output language for the Edge Prompt API — silences the "No output language
// was specified" advisory. Must match the options used elsewhere (en).
const AION_OUTPUT = [{ type: "text", languages: ["en"] }];

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
      // Open the trial's captured link in a NEW tab first, then run the cancellation there.
      // Use only the ORIGIN (scheme + host) — transient confirmation/checkout URLs with deep
      // paths/queries are poor starting points, so the agent starts from the site root.
      // websiteUrl is a bare hostname, so add a scheme before parsing. Fall back to the active tab.
      const captured = trial.pageUrl || trial.websiteUrl || "";
      let url = null;
      if (captured) {
        const withScheme = /^https?:\/\//i.test(captured) ? captured : `https://${captured}`;
        try { url = new URL(withScheme).origin + "/"; } catch { url = withScheme; }
      }
      let tab;
      if (url) {
        tab = await chrome.tabs.create({ url, active: true });
      } else {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      }
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

  // Fast path: if a prior session already recorded the model as downloaded, show "ready"
  // WITHOUT the slow on-device availability() probe. That probe warms up the Aion runtime
  // and is the main thing making the popup feel sluggish on open — and its result isn't
  // even needed once aionReady is set (we'd show "ready" regardless). storage.local read is cheap.
  const { aionReady } = await chrome.storage.local.get("aionReady");
  if (aionReady) {
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 2000);
    return;
  }

  // Not known-ready yet → probe availability (only until the model is downloaded the first time).
  let av;
  try { av = await LanguageModel.availability({ expectedOutputs: AION_OUTPUT }); } catch { av = "unknown"; }

  if (av === "available") {
    // Keep the flag in sync so content.js detection re-runs (via bridge) if it was waiting.
    chrome.storage.local.set({ aionReady: true, aionNeedsDownload: false });
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 2000);
    return;
  }

  if (av === "unavailable") {
    statusEl.className = "ai-status error";
    statusEl.textContent = "⚠️ Aion 1.0 model unavailable on this device.";
    statusEl.classList.remove("hidden");
    return;
  }

  // downloadable / downloading / unknown — the model isn't ready. Offer a one-click
  // entry point to the download page (which provides the user gesture create() needs).
  statusEl.className = "ai-status downloading";
  statusEl.textContent = "On-device AI model isn't downloaded yet. It powers trial detection and cancellation.";
  const btn = document.createElement("button");
  btn.className = "ai-init-btn";
  btn.textContent = "⬇️ Download AI model";
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("download/download.html") });
    window.close();
  });
  statusEl.appendChild(btn);
  statusEl.classList.remove("hidden");
}

// Defer the AI-status check to idle so the visible content (trial list, email) renders first.
(window.requestIdleCallback || ((cb) => setTimeout(cb, 0)))(checkAionStatus);

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
