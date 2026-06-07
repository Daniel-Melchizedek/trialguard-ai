const { AgentsClient } = require("@azure/ai-agents");
const { DefaultAzureCredential } = require("@azure/identity");

let _client = null;
let _agentId = null;

const AGENT_NAME = "trialguard-tip-agent";
const AGENT_INSTRUCTIONS =
  "You are a concise software advisor. When asked about a software trial, give exactly ONE specific, " +
  "actionable tip to help the user get maximum value from it today. Keep it to 1-2 sentences. " +
  "Plain English only. No markdown, no bullet points. Do not mention cancellation, billing, or pricing.";

function getClient() {
  if (!_client) {
    const endpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
    if (!endpoint) throw new Error("AZURE_AI_PROJECT_ENDPOINT is not set");
    _client = new AgentsClient(endpoint, new DefaultAzureCredential());
  }
  return _client;
}

async function getOrCreateAgent(model) {
  if (_agentId) return _agentId;

  const client = getClient();

  // Reuse existing agent if already created in this project
  const list = client.listAgents();
  for await (const existing of list) {
    if (existing.name === AGENT_NAME) {
      _agentId = existing.id;
      return _agentId;
    }
  }

  const agent = await client.createAgent(model, {
    name: AGENT_NAME,
    instructions: AGENT_INSTRUCTIONS,
    temperature: 0.9,
  });
  _agentId = agent.id;
  return _agentId;
}

async function generateTipWithAgent(trial) {
  const model = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini";
  const client = getClient();
  const agentId = await getOrCreateAgent(model);

  let daysText = "some time";
  if (trial.trialEndDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(trial.trialEndDate);
    end.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((end - today) / 86400000));
    daysText = `${days} day${days === 1 ? "" : "s"}`;
  }

  const thread = await client.threads.create();
  try {
    await client.messages.create(
      thread.id,
      "user",
      `I have ${daysText} left on my free trial of "${trial.productName}". ` +
        `Give me exactly ONE specific, actionable tip to get maximum value from it today.`
    );

    const run = await client.runs.createAndPoll(thread.id, agentId, {
      pollingOptions: { intervalInMs: 1500 },
    });

    if (run.status !== "completed") {
      throw new Error(`Agent run ended with status: ${run.status}`);
    }

    // Get the most recent assistant message
    const messages = client.messages.list(thread.id, { order: "desc" });
    for await (const msg of messages) {
      if (msg.role === "assistant") {
        const text = msg.content.find((c) => c.type === "text");
        if (text?.text?.value) return text.text.value.trim();
        break;
      }
    }

    return null;
  } finally {
    // Clean up thread regardless of success/failure
    await client.threads.delete(thread.id).catch(() => {});
  }
}

module.exports = { generateTipWithAgent };
