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

async function sendReminderEmail(trial) {
  const client = getEmailClient();
  const endDate = formatDate(trial.trialEndDate);
  const cancelUrl = trial.websiteUrl || "#";

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
    .alert-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px;
                 border-radius: 4px; margin: 20px 0; font-size: 14px; color: #78350f; }
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
      <p>Your free trial for <strong>${trial.productName}</strong> is ending in <strong>3 days</strong>.</p>

      <div class="alert-box">
        ⏰ Trial ends on: <strong>${endDate}</strong><br />
        To avoid being charged, you must cancel <strong>before</strong> this date.
      </div>

      <a href="${cancelUrl}" class="cta">Cancel My Subscription →</a>

      <div class="ignore">
        <strong>Please ignore this message if you do not want to get charged.</strong><br />
        This reminder was automatically sent by TrialGuard. You can manage your reminders
        in the TrialGuard browser extension.
      </div>
    </div>
    <div class="footer">
      Sent by TrialGuard · Powered by Aion 1.0 on-device AI + Azure
    </div>
  </div>
</body>
</html>`;

  const plainText = `TrialGuard Reminder

Your free trial for ${trial.productName} ends in 3 days (${endDate}).

To avoid being charged, cancel before ${endDate}:
${cancelUrl}

Please ignore this message if you do not want to get charged.

---
Sent by TrialGuard.`;

  const message = {
    senderAddress: process.env.EMAIL_SENDER,
    content: {
      subject: `⏰ Your ${trial.productName} trial ends in 3 days — cancel to avoid charges`,
      plainText,
      html: htmlBody
    },
    recipients: {
      to: [{ address: trial.userEmail }]
    }
  };

  const poller = await client.beginSend(message);
  return poller.pollUntilDone();
}

module.exports = { sendReminderEmail };
