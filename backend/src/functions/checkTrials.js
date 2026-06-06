const { app } = require("@azure/functions");
const { getTrialsDueForReminder, markDailyReminderSent } = require("../utils/cosmosClient");
const { sendReminderEmail } = require("../utils/emailClient");
const { generateTrialTip } = require("../utils/aiClient");

// Runs every day at 9:00 AM UTC
app.timer("checkTrials", {
  schedule: "0 0 9 * * *",
  handler: async (myTimer, context) => {
    context.log("[TrialGuard] checkTrials timer fired");

    let trials;
    try {
      trials = await getTrialsDueForReminder();
    } catch (err) {
      context.error("[TrialGuard] Failed to query Cosmos DB:", err.message);
      return;
    }

    context.log(`[TrialGuard] Found ${trials.length} trial(s) due for daily reminder`);

    for (const trial of trials) {
      let tip = null;
      try {
        tip = await generateTrialTip(trial);
        context.log(`[TrialGuard] Generated tip for ${trial.productName}`);
      } catch (err) {
        context.warn(
          `[TrialGuard] Tip generation failed for ${trial.productName}, sending without tip:`,
          err.message
        );
      }

      try {
        await sendReminderEmail(trial, tip);
        await markDailyReminderSent(trial.id, trial.userEmail);
        context.log(`[TrialGuard] Daily reminder sent to ${trial.userEmail} for ${trial.productName}`);
      } catch (err) {
        context.error(
          `[TrialGuard] Failed to send daily reminder for ${trial.id}:`,
          err.message
        );
      }
    }
  }
});
