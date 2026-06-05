// Normalise any date string the model returns → YYYY-MM-DD
function toISODate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // always YYYY-MM-DD
}

// Runs in ISOLATED world (default) — has full chrome.* API access.
// Receives trial data from content.js (MAIN world) via window.postMessage,
// saves directly to chrome.storage.sync, then forwards to background for backend save.

function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  if (!e.data || e.data.type !== "TRIALGUARD_DETECTED") return;

  if (!isContextValid()) {
    console.warn("[TrialGuard Bridge] Extension context invalidated — refresh the page to re-activate TrialGuard");
    return;
  }

  const trial = e.data.payload;
  console.log("[TrialGuard Bridge] Received trial from MAIN world:", trial.productName);

  // Write directly to storage — no dependency on service worker being alive
  try { chrome.storage.sync.get(["trials"], (data) => {
    const trials = data.trials || [];

    // Avoid duplicates (same product + same URL within 1 hour)
    const isDuplicate = trials.some(t =>
      t.productName === trial.productName &&
      t.websiteUrl  === trial.websiteUrl &&
      Date.now() - new Date(t.detectedAt).getTime() < 3600000
    );

    if (isDuplicate) {
      console.log("[TrialGuard Bridge] Duplicate — skipping");
      return;
    }

    // Normalise end date — model may return "2026-06-06 17:59 UTC" or other formats
    let trialEndDate = toISODate(trial.trialEndDate);

    // If model gave no end date but gave duration, calculate it ourselves
    if (!trialEndDate && trial.trialDurationDays) {
      const d = new Date();
      d.setDate(d.getDate() + Number(trial.trialDurationDays));
      trialEndDate = d.toISOString().slice(0, 10);
    }

    trials.unshift({
      id:               crypto.randomUUID(),
      productName:      trial.productName,
      websiteUrl:       trial.websiteUrl || trial.pageUrl || "",
      trialDurationDays: trial.trialDurationDays || null,
      trialEndDate,
      pageTitle:        trial.pageTitle || "",
      detectedAt:       new Date().toISOString()
    });

    chrome.storage.sync.set({ trials: trials.slice(0, 50) }, () => {
      console.log("[TrialGuard Bridge] Saved to storage ✓");
    });
  }); } catch (err) {
    console.warn("[TrialGuard Bridge] Storage write failed:", err.message);
  }

  // Also forward to background for Azure backend save (best-effort)
  try {
    chrome.runtime.sendMessage({ action: "trialDetected", data: trial }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[TrialGuard Bridge] Background message failed:", chrome.runtime.lastError.message);
      } else {
        console.log("[TrialGuard Bridge] Background acknowledged:", response);
      }
    });
  } catch (err) {
    console.warn("[TrialGuard Bridge] sendMessage failed:", err.message);
  }
});
