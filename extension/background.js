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
  if (message.action !== "trialDetected") return;

  const handle = async () => {
    const { userEmail } = await getSettings();

    if (!userEmail) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
      return;
    }

    await storeLocalTrial(message.data, userEmail);

    try {
      await saveTrial(message.data, userEmail);
      chrome.action.setBadgeText({ text: "✓", tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    } catch (err) {
      console.error("[TrialGuard] Failed to save to backend:", err);
    }
  };

  handle();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
