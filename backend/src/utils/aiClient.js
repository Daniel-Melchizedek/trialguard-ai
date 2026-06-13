const { fetchProductContext } = require("./webRetriever");
const { generateTipWithAgent } = require("./agentClient");

function computeDaysLeft(trialEndDate) {
  if (!trialEndDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(trialEndDate);
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((end - today) / (1000 * 60 * 60 * 24)));
}

function computeDayNumber(detectedAt) {
  if (!detectedAt) return 1;
  const start = new Date(detectedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1);
}

async function generateTrialTip(trial) {
  // Always return a non-empty tip so the email never goes out missing its "Today's tip"
  // box. A transient failure in the agent path (e.g. a 429 rate-limit on the model) must
  // NOT bubble up — otherwise the caller catches it and sends a tip-less email.
  const fallback =
    `Explore the key features of ${trial.productName} today to make the most of your remaining trial time.`;
  try {
    const context = await fetchProductContext(trial.websiteUrl, trial.productName);
    const tip = await generateTipWithAgent(trial, context);
    return (tip && tip.trim()) || fallback;
  } catch (err) {
    console.error(`[TrialGuard] Tip generation failed for ${trial.productName}: ${err?.message || err}`);
    return fallback;
  }
}

module.exports = { generateTrialTip, computeDaysLeft, computeDayNumber };
