const { app } = require("@azure/functions");
const { upsertTrial, markDailyReminderSent } = require("../utils/cosmosClient");
const { sendReminderEmail } = require("../utils/emailClient");
const { generateTrialTip } = require("../utils/aiClient");
const { randomUUID } = require("crypto");

app.http("saveTrial", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "save-trial",
  handler: async (request, context) => {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return {
        status: 200,
        headers: corsHeaders()
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { userEmail, productName, trialEndDate, trialDurationDays, websiteUrl, pageTitle } = body;

    if (!userEmail || !productName) {
      return jsonResponse(400, { error: "userEmail and productName are required" });
    }

    // Derive end date from duration if not provided
    let endDate = trialEndDate;
    if (!endDate && trialDurationDays) {
      const d = new Date();
      d.setDate(d.getDate() + Number(trialDurationDays));
      endDate = d.toISOString().slice(0, 10);
    }

    // 3 days before trial ends
    let reminderDueDate = null;
    if (endDate) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - 3);
      reminderDueDate = d.toISOString().slice(0, 10);
    }

    const trial = {
      id: randomUUID(),
      userEmail,
      productName,
      websiteUrl: websiteUrl || null,
      pageTitle: pageTitle || null,
      trialDurationDays: trialDurationDays ? Number(trialDurationDays) : null,
      trialEndDate: endDate || null,
      reminderDueDate,
      reminderSent: false,
      reminderSentAt: null,
      lastReminderSentAt: null,
      detectedAt: new Date().toISOString()
    };

    let saved;
    try {
      saved = await upsertTrial(trial);
      context.log(`[TrialGuard] Saved trial: ${productName} for ${userEmail}`);
    } catch (err) {
      context.log.error("[TrialGuard] Cosmos DB error:", err.message);
      return jsonResponse(500, { error: "Failed to save trial" });
    }

    // Send Day 1 email immediately — don't wait for the 9 AM timer
    try {
      const tip = await generateTrialTip(saved).catch(() => null);
      await sendReminderEmail(saved, tip);
      await markDailyReminderSent(saved.id, saved.userEmail);
      context.log(`[TrialGuard] Day 1 email sent for ${productName} to ${userEmail}`);
    } catch (err) {
      context.log.warn(`[TrialGuard] Day 1 email failed (trial still saved): ${err.message}`);
    }

    return jsonResponse(201, { success: true, id: saved.id });
  }
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key"
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    },
    body: JSON.stringify(body)
  };
}
