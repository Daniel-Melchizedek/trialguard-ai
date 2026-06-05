// Service worker — receives trial detections from content.js, saves to backend.

importScripts('config.js');

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(["userEmail"], data => {
      resolve({ userEmail: data.userEmail || null });
    });
  });
}

async function saveTrial(trialData, userEmail) {
  const payload = {
    userEmail,
    productName: trialData.productName,
    trialDurationDays: trialData.trialDurationDays,
    trialEndDate: trialData.trialEndDate,
    websiteUrl: trialData.websiteUrl || trialData.pageUrl,
    pageTitle: trialData.pageTitle
  };

  const resp = await fetch(`${CONFIG.BACKEND_URL}/api/save-trial`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-functions-key": CONFIG.FUNCTION_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
  return resp.json();
}

async function storeLocalTrial(trialData, userEmail) {
  return new Promise(resolve => {
    chrome.storage.sync.get(["trials"], data => {
      const trials = data.trials || [];
      trials.unshift({
        id: crypto.randomUUID(),
        userEmail,
        productName: trialData.productName,
        trialEndDate: trialData.trialEndDate,
        trialDurationDays: trialData.trialDurationDays,
        websiteUrl: trialData.websiteUrl || trialData.pageUrl,
        detectedAt: new Date().toISOString()
      });
      chrome.storage.sync.set({ trials: trials.slice(0, 50) }, resolve);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[TrialGuard BG] message received:", message.action);
  if (message.action !== "trialDetected") return;

  const handle = async () => {
    try {
      const { userEmail } = await getSettings();

      // Storage already written by bridge.js — just handle badge + backend save
      if (sender.tab?.id) {
        chrome.action.setBadgeText({ text: "✓", tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId: sender.tab.id });
      }

      if (!userEmail) {
        chrome.action.setBadgeText({ text: "!" });
        chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
        sendResponse({ saved: true, backend: false });
        return;
      }

      try {
        await saveTrial(message.data, userEmail);
        console.log("[TrialGuard BG] Saved to Azure backend");
        sendResponse({ saved: true, backend: true });
      } catch (err) {
        console.error("[TrialGuard BG] Backend save failed:", err.message);
        sendResponse({ saved: true, backend: false, error: err.message });
      }
    } catch (err) {
      console.error("[TrialGuard BG] Handler error:", err.message);
      sendResponse({ saved: false, error: err.message });
    }
  };

  handle();
  return true; // keep message channel open for async sendResponse
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
