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

  const availability = await LanguageModel.availability();
  console.log("[TrialGuard] popup: model availability =", availability);

  if (availability === "available") {
    statusEl.className = "ai-status ready";
    statusEl.textContent = "✓ Aion 1.0 ready — on-device AI active";
    statusEl.classList.remove("hidden");
    setTimeout(() => statusEl.classList.add("hidden"), 3000);
    return;
  }

  if (availability === "unavailable") {
    statusEl.className = "ai-status error";
    statusEl.textContent = "⚠️ Aion 1.0 model unavailable on this device.";
    statusEl.classList.remove("hidden");
    return;
  }

  // Check if a download is already in progress (progress saved by a previous popup session)
  const stored = await chrome.storage.local.get(["aionProgress", "aionError"]);
  if (stored.aionError) {
    statusEl.className = "ai-status error";
    statusEl.textContent = `⚠️ Previous download failed: ${stored.aionError}`;
    statusEl.classList.remove("hidden");
    chrome.storage.local.remove("aionError");
  } else if (stored.aionProgress) {
    const p = stored.aionProgress;
    const age = Math.round((Date.now() - p.ts) / 1000);
    const pctTxt = p.pct != null ? `${p.pct}%` : `${(p.loaded/1024/1024).toFixed(0)} MB`;
    statusEl.className = "ai-status downloading";
    statusEl.innerHTML = `<span class="spinner"></span> Downloading… last seen ${pctTxt} (${age}s ago). Keep popup open.`;
    statusEl.classList.remove("hidden");
  }

  // "downloadable" or "downloading"
  statusEl.className = "ai-status downloading";
  statusEl.innerHTML = `<span class="spinner"></span> Aion 1.0 model not downloaded yet.`;
  statusEl.classList.remove("hidden");

  const btn = document.createElement("button");
  btn.className = "ai-init-btn";
  btn.textContent = "⬇️ Download Aion 1.0 Model";
  statusEl.after(btn);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "⏳ Downloading… reopen popup to check status";
    statusEl.innerHTML = `<span class="spinner"></span> Download started — reopen this popup to check progress.`;

    // Fire LanguageModel.create() — Edge may continue downloading even if popup closes
    LanguageModel.create({
      expectedOutputLanguages: ["en"],
      monitor(m) {
        m.addEventListener("downloadprogress", e => {
          chrome.storage.local.set({
            aionProgress: {
              loaded: e.loaded,
              total: e.total,
              pct: e.total > 0 ? Math.round((e.loaded / e.total) * 100) : null,
              ts: Date.now()
            }
          });
        });
      }
    }).then(session => {
      session.destroy();
      chrome.storage.local.set({ aionReady: true, aionProgress: null });
    }).catch(err => {
      chrome.storage.local.set({ aionError: err.message });
    });
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
