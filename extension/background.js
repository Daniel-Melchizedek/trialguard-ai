// Service worker — handles trial detections and automated cancellation

importScripts('config.js');
importScripts('mcpClient.js');

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(["userEmail", "backendUrl"], data => {
      resolve({
        userEmail: data.userEmail || null,
        backendUrl: data.backendUrl || CONFIG.BACKEND_URL
      });
    });
  });
}

// ─── Trial detection (original) ───────────────────────────────────────────────

async function saveTrial(trialData, userEmail, backendUrl) {
  const payload = {
    userEmail,
    productName: trialData.productName,
    trialDurationDays: trialData.trialDurationDays,
    trialEndDate: trialData.trialEndDate,
    websiteUrl: trialData.websiteUrl || trialData.pageUrl,
    pageTitle: trialData.pageTitle
  };
  const resp = await fetch(`${backendUrl}/api/save-trial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// ─── Cancellation — state ─────────────────────────────────────────────────────

const _abortControllers = new Map(); // trialId → AbortController

function notifySP(type, payload) {
  chrome.runtime.sendMessage({ action: "spUpdate", type, payload }).catch(() => {});
}

function spToast(type, message, trialId) {
  notifySP("toast", { type, message, trialId });
}

// ─── Cancellation — backend patch ─────────────────────────────────────────────

async function patchTrialRemote(id, userEmail, fields, backendUrl) {
  const resp = await fetch(`${backendUrl}/api/patch-trial`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, userEmail, ...fields })
  });
  if (!resp.ok) throw new Error(`Patch failed: ${resp.status}`);
}

async function updateLocalTrial(trialId, fields) {
  return new Promise(resolve => {
    chrome.storage.sync.get(["trials"], data => {
      const trials = (data.trials || []).map(t =>
        t.id === trialId ? { ...t, ...fields } : t
      );
      chrome.storage.sync.set({ trials }, resolve);
    });
  });
}

// ─── Cancellation — page text ─────────────────────────────────────────────────

async function extractPageText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => (document.body?.innerText || "").slice(0, 5000)
    });
    return results[0]?.result || "";
  } catch {
    return "";
  }
}

// ─── Cancellation — Aion planning ─────────────────────────────────────────────

function buildAionPrompt(trial, pageText) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a cancellation step planner. Today is ${today}.
A user wants to cancel their "${trial.productName}" trial${trial.websiteUrl ? ` at ${trial.websiteUrl}` : ""}.

Each step must be one of: navigate | click | fill | wait
Maximum 8 steps. The final step must submit the cancellation.
If you cannot determine steps from this page, return steps:[].

Return ONLY valid JSON (no markdown):
{
  "steps": [
    { "index": 1, "action": "navigate", "value": "https://...", "description": "Go to billing settings" },
    { "index": 2, "action": "click", "selector": "#cancel-subscription", "description": "Click cancel button" }
  ],
  "confidence": "high|medium|low",
  "notes": "optional explanation"
}

Page content (first 2500 chars):
${pageText.slice(0, 2500)}`;
}

function parseAionResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
  return JSON.parse(cleaned);
}

async function callAionPlan(trial, pageText, tabId) {
  // Try service worker scope first (Edge 150+ may expose LanguageModel globally)
  if (typeof LanguageModel !== "undefined") {
    try {
      const session = await LanguageModel.create({ temperature: 0.1, topK: 1 });
      const response = await session.prompt(buildAionPrompt(trial, pageText));
      session.destroy();
      return parseAionResponse(response);
    } catch (e) {
      console.warn("[TrialGuard BG] SW LanguageModel failed, trying injection:", e.message);
    }
  }

  // Fall back to injected MAIN-world script
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (prompt) => {
      try {
        if (typeof LanguageModel === "undefined") return { error: "Aion not available in this browser" };
        const session = await LanguageModel.create({ temperature: 0.1, topK: 1 });
        const text = await session.prompt(prompt);
        session.destroy();
        return { text: text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "") };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [buildAionPrompt(trial, pageText)]
  });

  const result = results[0]?.result;
  if (!result || result.error) throw new Error(result?.error || "Aion injection failed");
  return JSON.parse(result.text);
}

// ─── Cancellation — MCP tool mapping ─────────────────────────────────────────

const MCP_TOOL = {
  navigate: "browser_navigate",
  click:    "browser_click",
  fill:     "browser_fill",
  wait:     "browser_wait_for_selector"
};

function buildMcpArgs(step) {
  switch (step.action) {
    case "navigate": return { url: step.value };
    case "click":    return { selector: step.selector };
    case "fill":     return { selector: step.selector, value: step.value };
    case "wait":     return { selector: step.selector };
    default:         return {};
  }
}

// ─── Cancellation — agent loop ────────────────────────────────────────────────

async function runCancellationAgent(trial, tabId) {
  const { backendUrl } = await getSettings();
  const trialId = trial.id;
  const ac = new AbortController();
  _abortControllers.set(trialId, ac);

  const patch = (fields) =>
    patchTrialRemote(trialId, trial.userEmail, fields, backendUrl).catch(() => {});

  try {
    // 1 — Check MCP availability
    spToast("planning", "Checking Playwright MCP connection…", trialId);
    const available = await MCPClient.isAvailable();
    if (!available) {
      notifySP("mcp_unavailable", { trialId });
      return;
    }

    // 2 — Plan with Aion
    spToast("planning", "Aion is planning the cancellation…", trialId);
    notifySP("phase", { phase: "planning", trialId });

    const pageText = await extractPageText(tabId);
    let plan;
    try {
      plan = await callAionPlan(trial, pageText, tabId);
    } catch (err) {
      spToast("error", `Planning failed: ${err.message}`, trialId);
      notifySP("phase", { phase: "failed", trialId });
      return;
    }

    if (!plan?.steps?.length) {
      notifySP("no_plan", { trialId, websiteUrl: trial.websiteUrl });
      return;
    }

    // 3 — Execute steps immediately
    await patch({
      cancellationStatus: "running",
      cancellationPlan: plan.steps,
      cancellationStartedAt: new Date().toISOString()
    });
    notifySP("phase", { phase: "running", trialId, stepCount: plan.steps.length });

    for (const step of plan.steps) {
      if (ac.signal.aborted) {
        await patch({ cancellationStatus: "stopped" });
        await updateLocalTrial(trialId, { cancellationStatus: "stopped" });
        spToast("stopped", "Cancellation stopped.", trialId);
        notifySP("phase", { phase: "stopped", trialId });
        return;
      }

      spToast("step", step.description, trialId);
      notifySP("step_start", { step, trialId });

      try {
        await MCPClient.callTool(MCP_TOOL[step.action] || step.action, buildMcpArgs(step));
        notifySP("step_done", { step, trialId });
      } catch (err) {
        const errMsg = `Step ${step.index} failed: ${err.message}`;
        spToast("error", errMsg, trialId);
        notifySP("step_error", { step, error: err.message, trialId });
        await patch({ cancellationStatus: "failed", cancellationError: errMsg });
        await updateLocalTrial(trialId, { cancellationStatus: "failed" });
        notifySP("phase", { phase: "failed", trialId });
        return;
      }
    }

    // 4 — Done
    await patch({
      cancellationStatus: "completed",
      cancellationCompletedAt: new Date().toISOString()
    });
    await updateLocalTrial(trialId, { cancellationStatus: "completed" });
    spToast("done", `${trial.productName} trial cancelled.`, trialId);
    notifySP("phase", { phase: "completed", trialId });

  } finally {
    _abortControllers.delete(trialId);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[TrialGuard BG] message received:", message.action);

  if (message.action === "trialDetected") {
    const handle = async () => {
      try {
        const { userEmail, backendUrl } = await getSettings();
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
          await saveTrial(message.data, userEmail, backendUrl);
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
    return true;
  }

  if (message.action === "requestCancellation") {
    const { trial, tabId } = message;
    runCancellationAgent(trial, tabId).catch(err => {
      console.error("[TrialGuard BG] Agent error:", err.message);
      notifySP("phase", { phase: "failed", trialId: trial?.id, error: err.message });
    });
    sendResponse({ started: true });
    return true;
  }

  if (message.action === "cancelStop") {
    const { trialId } = message;
    const ac = _abortControllers.get(trialId);
    if (ac) ac.abort();
    sendResponse({ stopped: !!ac });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
