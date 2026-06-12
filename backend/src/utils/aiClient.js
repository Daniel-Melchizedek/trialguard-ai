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
  // Retrieve up-to-date product context (unchanged), then generate the tip via the
  // Azure AI Foundry agent instead of calling the model directly. Behaviour is the
  // same: same persona/constraints (agent instructions), same context, same sampling.
  const context = await fetchProductContext(trial.websiteUrl, trial.productName);
  const tip = await generateTipWithAgent(trial, context);

  return (
    (tip && tip.trim()) ||
    `Explore the key features of ${trial.productName} today to make the most of your remaining trial time.`
  );
}

module.exports = { generateTrialTip, computeDaysLeft, computeDayNumber };
