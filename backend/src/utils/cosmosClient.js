const { CosmosClient } = require("@azure/cosmos");

let _container = null;

function getContainer() {
  if (_container) return _container;

  const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY
  });

  _container = client
    .database(process.env.COSMOS_DATABASE || "trialguard")
    .container(process.env.COSMOS_CONTAINER || "trials");

  return _container;
}

async function upsertTrial(trial) {
  const container = getContainer();
  const { resource } = await container.items.upsert(trial);
  return resource;
}

async function getTrialsDueForReminder() {
  const container = getContainer();
  const today = new Date().toISOString().slice(0, 10);

  const { resources } = await container.items
    .query({
      query: `SELECT * FROM c
              WHERE c.trialEndDate >= @today
              AND (
                NOT IS_DEFINED(c.lastReminderSentAt)
                OR c.lastReminderSentAt < @today
              )`,
      parameters: [{ name: "@today", value: today }]
    })
    .fetchAll();

  return resources;
}

// Legacy — kept for backward compatibility
async function markReminderSent(id, userEmail) {
  const container = getContainer();
  await container.item(id, userEmail).patch([
    { op: "set", path: "/reminderSent", value: true },
    { op: "set", path: "/reminderSentAt", value: new Date().toISOString() }
  ]);
}

async function markDailyReminderSent(id, userEmail) {
  const container = getContainer();
  const today = new Date().toISOString().slice(0, 10);
  await container.item(id, userEmail).patch([
    { op: "set", path: "/lastReminderSentAt", value: today },
    { op: "set", path: "/reminderSent", value: true },
    { op: "set", path: "/reminderSentAt", value: new Date().toISOString() }
  ]);
}

async function patchCancellationStatus(id, userEmail, fields) {
  const container = getContainer();
  const ops = Object.entries(fields).map(([k, v]) => ({ op: "set", path: `/${k}`, value: v }));
  await container.item(id, userEmail).patch(ops);
}

module.exports = { upsertTrial, getTrialsDueForReminder, markReminderSent, markDailyReminderSent, patchCancellationStatus };
