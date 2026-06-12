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

// After the extension is reloaded, the content scripts on already-open tabs are orphaned
// (their chrome.* link is gone). That's expected and does NOT affect the cancellation agent
// (which injects fresh scripts via chrome.scripting). Warn ONCE, quietly, to avoid console spam.
let _ctxWarned = false;
function warnContextOnce() {
  if (_ctxWarned) return;
  _ctxWarned = true;
  console.debug("[TrialGuard Bridge] Extension reloaded — this tab's content script is stale. Refresh the page to re-activate detection. (Cancellation via the popup still works.)");
}

// ── DEBUG HOOKS (for Playwright-driven testing of the cancellation agent) ──
// Trigger a cancellation from the page; background fills tabId from sender.tab.id.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "TG_TRIGGER_CANCEL") return;
  if (!isContextValid()) { console.log("[TG-SP] error context-invalid"); return; }
  console.log("[TG-SP] trigger", JSON.stringify(e.data.trial));
  chrome.runtime.sendMessage({ action: "requestCancellation", trial: e.data.trial });
});
// Reload the extension from disk (so code fixes take effect).
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "TG_RELOAD") return;
  if (!isContextValid()) return;
  chrome.runtime.sendMessage({ action: "tgReload" });
});
// Read the agent's progress trace from storage (the SW mirrors spUpdate there).
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "TG_READ_TRACE") return;
  if (!isContextValid()) return;
  chrome.storage.local.get("tgTrace", (d) => {
    console.log("[TG-TRACE]", JSON.stringify(d.tgTrace || []));
  });
});
// Clear the trace before a fresh run.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "TG_CLEAR_TRACE") return;
  if (!isContextValid()) return;
  chrome.storage.local.set({ tgTrace: [] });
});
// ── END DEBUG HOOKS ──

// ── Aion model readiness bridge (content.js is MAIN world → no chrome.* access) ──
// content.js tells us when the on-device model isn't downloaded yet; record it so the
// popup can surface a "Download AI model" button.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "TRIALGUARD_AION_STATUS") return;
  if (!isContextValid()) return;
  if (e.data.available === false) {
    try { chrome.storage.local.set({ aionNeedsDownload: true }); } catch (_) {}
  }
});

// When the model finishes downloading (download.js sets aionReady in local), tell the
// MAIN-world content script to re-run detection on this already-open page.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.aionReady && changes.aionReady.newValue) {
      window.postMessage({ type: "TRIALGUARD_AION_READY" }, "*");
    }
  });
} catch (_) { /* context may be invalid on an orphaned content script */ }

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  if (!e.data || e.data.type !== "TRIALGUARD_DETECTED") return;

  if (!isContextValid()) {
    warnContextOnce();
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
