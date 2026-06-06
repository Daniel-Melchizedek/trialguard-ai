const { AzureOpenAI } = require("@azure/openai");
const { fetchProductContext } = require("./webRetriever");

let _client = null;

function getClient() {
  if (!_client) {
    _client = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_KEY,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini",
      apiVersion: "2024-10-21"
    });
  }
  return _client;
}

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
  const context = await fetchProductContext(trial.websiteUrl, trial.productName);
  const daysLeft = computeDaysLeft(trial.trialEndDate);

  const systemMsg = context
    ? `You are a concise software advisor. Use the following up-to-date product information to give a specific tip:\n\n${context}`
    : `You are a concise software advisor with broad knowledge of popular software products.`;

  const daysText = daysLeft !== null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "some time";
  const userMsg =
    `I have ${daysText} left on my free trial of "${trial.productName}". ` +
    `Give me exactly ONE specific, actionable tip to get maximum value from it today. ` +
    `1-2 sentences only. Plain English. No markdown, no bullet points. ` +
    `Do not mention cancellation, billing, or pricing.`;

  const response = await getClient().chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg }
    ],
    max_tokens: 120,
    temperature: 0.9,
    top_p: 0.95
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    `Explore the key features of ${trial.productName} today to make the most of your remaining trial time.`
  );
}

module.exports = { generateTrialTip, computeDaysLeft, computeDayNumber };
