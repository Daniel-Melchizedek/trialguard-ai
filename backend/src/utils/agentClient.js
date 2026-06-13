const { AIProjectClient } = require("@azure/ai-projects");
const { DefaultAzureCredential } = require("@azure/identity");

let _project = null;
let _openai = null;
let _agentName = null;

const AGENT_NAME = "trialguard-tip-agent";
const AGENT_INSTRUCTIONS =
  "You are a concise software advisor. When asked about a software trial, give exactly ONE specific, " +
  "actionable tip to help the user get maximum value from it today. Keep it to 1-2 sentences. " +
  "Plain English only. No markdown, no bullet points. Do not mention cancellation, billing, or pricing. " +
  "You may use the web search tool to find current, specific details about the product when it helps you give a better tip, " +
  "but respond with plain prose only — do NOT include citations, source names, footnotes, links, or URLs in your answer.";

function getProject() {
  if (!_project) {
    const endpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
    if (!endpoint) throw new Error("AZURE_AI_PROJECT_ENDPOINT is not set");
    _project = new AIProjectClient(endpoint, new DefaultAzureCredential());
  }
  return _project;
}

function getOpenAI() {
  if (!_openai) _openai = getProject().getOpenAIClient();
  return _openai;
}

// New Foundry "Agents v2": a persistent, versioned prompt agent created on the
// project. createVersion creates the agent (and its first version) if it doesn't
// exist; update only adds a new version when the definition actually changes
// (no-op otherwise), so this is idempotent across cold starts — no version sprawl.
async function getOrCreateAgent() {
  if (_agentName) return _agentName;
  const project = getProject();
  const definition = {
    kind: "prompt",
    model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini",
    instructions: AGENT_INSTRUCTIONS,
    temperature: 0.9,
    top_p: 0.95,
    tools: [{ type: "web_search_preview" }],
  };

  let exists = true;
  try {
    await project.agents.get(AGENT_NAME);
  } catch {
    exists = false;
  }
  if (exists) {
    await project.agents.update(AGENT_NAME, definition);
  } else {
    await project.agents.createVersion(AGENT_NAME, definition);
  }
  _agentName = AGENT_NAME;
  return _agentName;
}

async function generateTipWithAgent(trial, context) {
  const name = await getOrCreateAgent();
  const openai = getOpenAI();

  let daysText = "some time";
  if (trial.trialEndDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(trial.trialEndDate);
    end.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((end - today) / 86400000));
    daysText = `${days} day${days === 1 ? "" : "s"}`;
  }

  // The persona + constraints live in the agent instructions. The per-request
  // product context (when retrieved) and the ask go in the response input — this
  // mirrors the previous system/user message split.
  const input =
    (context
      ? `Here is the authoritative description of this exact product (from its own website). ` +
        `Base your tip ONLY on what THIS product actually does — do not invent features it doesn't ` +
        `mention, and ignore any unrelated product that merely shares a similar name:\n\n${context}\n\n`
      : `If you are not certain what this specific product does, give a safe general getting-started ` +
        `tip rather than guessing specific features.\n\n`) +
    `I have ${daysText} left on my free trial of "${trial.productName}". ` +
    `Give me exactly ONE specific, actionable tip to get maximum value from it today.`;

  // Invoke the agent via the Responses API (agent_reference resolves by name to
  // the agent's latest version). Sampling (temperature/top_p) is set on the agent
  // definition; max_output_tokens matches the previous 120-token cap.
  // maxRetries/timeout: the OpenAI client retries transient failures (429 rate-limit,
  // 5xx, timeouts) with exponential backoff — this is the main reason tips occasionally
  // failed. Bump retries so the real tip survives transient blips before any fallback.
  const response = await openai.responses.create(
    { input, max_output_tokens: 120 },
    { body: { agent_reference: { name, type: "agent_reference" } }, maxRetries: 4, timeout: 60000 }
  );

  return sanitizeTip(response.output_text);
}

// The web search tool can make the model append citations / source links even
// when told not to. The email HTML-escapes the tip (no markdown rendering), so
// strip any markdown links, bare URLs, and trailing citation fragments to keep
// the tip clean prose.
function sanitizeTip(text) {
  if (!text) return null;
  let t = text
    .replace(/\s*\[[^\]]*\]\((https?:\/\/[^)]+)\)/g, "") // [title](url) citations
    .replace(/\s*\((https?:\/\/[^)]+)\)/g, "")           // (url)
    .replace(/https?:\/\/\S+/g, "")                       // bare URLs
    .replace(/\s*\[\d+\]/g, "")                           // [1] style footnotes
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return t || null;
}

module.exports = { generateTipWithAgent };
