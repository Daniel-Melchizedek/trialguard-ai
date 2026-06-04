const { app } = require("@azure/functions");
const { getTrialsDueForReminder, markReminderSent } = require("../utils/cosmosClient");
const { sendReminderEmail } = require("../utils/emailClient");

// Runs every day at 9:00 AM UTC
app.timer("checkTrials", {
  schedule: "0 0 9 * * *",
  handler: async (myTimer, context) => {
    context.log("[TrialGuard] checkTrials timer fired");

    let trials;
    try {
      trials = await getTrialsDueForReminder();
    } catch (err) {
      context.log.error("[TrialGuard] Failed to query Cosmos DB:", err.message);
      return;
    }

    context.log(`[TrialGuard] Found ${trials.length} trial(s) due for reminder`);

    for (const trial of trials) {
      try {
        await sendReminderEmail(trial);
        await markReminderSent(trial.id, trial.userEmail);
        context.log(`[TrialGuard] Reminder sent to ${trial.userEmail} for ${trial.productName}`);
      } catch (err) {
        context.log.error(
          `[TrialGuard] Failed to send reminder for ${trial.id}:`,
          err.message
        );
      }
    }
  }
});
