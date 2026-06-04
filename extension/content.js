// Runs on every page at document_idle.
// Uses Aion 1.0 Instruct (Edge Prompt API) — 100% on-device, no data sent to cloud.

const TRIAL_KEYWORDS = [
  "free trial", "start your trial", "start trial", "begin trial",
  "days free", "cancel anytime", "no credit card required",
  "try for free", "try free", "free for", "day free trial",
  "month free", "trial period", "trial subscription"
];

let alreadyChecked = false;

function hasTrialKeywords(text) {
  const lower = text.toLowerCase();
  return TRIAL_KEYWORDS.some(kw => lower.includes(kw));
}

async function detectTrialWithAion(pageText) {
  if (typeof LanguageModel === "undefined") {
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const session = await LanguageModel.create({ temperature: 0.2, topK: 10 });

  const prompt = `You are a free trial subscription detector. Today is ${today}.
Analyze the following webpage text and determine if the user has just signed up for or is about to sign up for a free trial.

Return ONLY valid JSON — no markdown, no explanation.
If a free trial is detected:
{"detected":true,"productName":"<name of product/service>","trialDurationDays":<number or null>,"trialEndDate":"<YYYY-MM-DD or null>","websiteUrl":"${window.location.hostname}"}

If no free trial is detected:
{"detected":false}

Webpage text (first 3000 chars):
${pageText.slice(0, 3000)}`;

  const raw = await session.prompt(prompt);
  session.destroy();

  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    return JSON.parse(raw.slice(start, end));
  } catch {
    return null;
  }
}

async function checkPage() {
  if (alreadyChecked) return;

  const pageText = document.body?.innerText || "";
  if (!hasTrialKeywords(pageText)) return;

  alreadyChecked = true;

  const result = await detectTrialWithAion(pageText);
  if (!result || !result.detected) return;

  result.pageUrl = window.location.href;
  result.pageTitle = document.title;

  chrome.runtime.sendMessage({ action: "trialDetected", data: result });
}

// Check on initial load
checkPage();

// Re-check on SPA navigation (URL changes without full reload)
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    alreadyChecked = false;
    setTimeout(checkPage, 1500);
  }
});
observer.observe(document.body, { childList: true, subtree: true });
