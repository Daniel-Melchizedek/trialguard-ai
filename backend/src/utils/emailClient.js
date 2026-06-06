const { EmailClient } = require("@azure/communication-email");

let _client = null;

function getEmailClient() {
  if (!_client) {
    _client = new EmailClient(process.env.ACS_CONNECTION_STRING);
  }
  return _client;
}

function formatDate(dateStr) {
  if (!dateStr) return "soon";
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

function getDaysLeft(trialEndDate) {
  if (!trialEndDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(trialEndDate);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end - today) / (1000 * 60 * 60 * 24)));
}

function getDayNumber(detectedAt) {
  if (!detectedAt) return 1;
  const start = new Date(detectedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today - start) / (1000 * 60 * 60 * 24)) + 1);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendReminderEmail(trial, tip) {
  const client = getEmailClient();
  const endDate = formatDate(trial.trialEndDate);
  const cancelUrl = trial.websiteUrl || "#";
  const daysLeft = getDaysLeft(trial.trialEndDate);
  const dayNumber = getDayNumber(trial.detectedAt);

  const subject = daysLeft !== null
    ? `Day ${dayNumber} of your ${trial.productName} trial — tip inside (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)`
    : `Your daily ${trial.productName} trial tip`;

  const tipSection = tip ? `
    <div class="tip-box">
      <div class="tip-label">Today's tip</div>
      <p class="tip-text">${escapeHtml(tip)}</p>
    </div>` : "";

  const countdownText = daysLeft !== null
    ? `⏰ Trial ends: <strong>${endDate}</strong> &nbsp;·&nbsp; <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining</strong>`
    : `⏰ Trial ends: <strong>${endDate}</strong>`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 32px auto; background: white; border-radius: 12px;
                 box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: #0f172a; color: white; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 6px 0 0; color: #94a3b8; font-size: 14px; }
    .body { padding: 28px 32px; color: #1e293b; line-height: 1.6; }
    .tip-box { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px 18px;
               border-radius: 4px; margin: 20px 0; }
    .tip-label { font-size: 11px; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.08em; color: #16a34a; margin-bottom: 8px; }
    .tip-text { margin: 0; font-size: 15px; color: #14532d; line-height: 1.5; }
    .countdown { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px;
                 border-radius: 4px; margin: 16px 0; font-size: 14px; color: #78350f; }
    .cta { display: inline-block; margin-top: 20px; padding: 12px 28px;
           background: #ef4444; color: white; text-decoration: none;
           border-radius: 8px; font-weight: 700; font-size: 15px; }
    .ignore { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;
              font-size: 12px; color: #94a3b8; }
    .footer { background: #f1f5f9; padding: 16px 32px; font-size: 11px;
              color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ TrialGuard</h1>
      <p>Your AI-powered trial watchdog</p>
    </div>
    <div class="body">
      <p>Hi there,</p>
      <p>Here is your daily update for your <strong>${trial.productName}</strong> free trial.</p>
      ${tipSection}
      <div class="countdown">${countdownText}</div>
      <a href="${cancelUrl}" class="cta">Manage Subscription →</a>
      <div class="ignore">
        <strong>Want to cancel?</strong> Visit the link above before your trial ends to avoid charges.<br />
        This daily reminder is sent by TrialGuard. Manage reminders in the TrialGuard browser extension.
      </div>
    </div>
    <div class="footer">
      Sent by TrialGuard · Powered by Azure OpenAI
    </div>
  </div>
</body>
</html>`;

  const plainText = [
    `TrialGuard Daily Update — ${trial.productName}`,
    "",
    tip ? `Today's tip: ${tip}` : "",
    "",
    `Trial ends: ${endDate}${daysLeft !== null ? ` (${daysLeft} days left)` : ""}`,
    "",
    `Manage your subscription: ${cancelUrl}`,
    "",
    "---",
    "Sent by TrialGuard."
  ].filter(line => line !== undefined).join("\n");

  const message = {
    senderAddress: process.env.EMAIL_SENDER,
    content: { subject, plainText, html: htmlBody },
    recipients: { to: [{ address: trial.userEmail }] }
  };

  const poller = await client.beginSend(message);
  return poller.pollUntilDone();
}

module.exports = { sendReminderEmail };
