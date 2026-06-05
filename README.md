# TrialGuard — AI-Powered Free Trial Watchdog

> Never get charged by surprise. TrialGuard detects free trial sign-ups as you browse and sends you a reminder email 3 days before the trial ends — so you can cancel in time.

## How It Works

1. **Browse normally** — the Edge extension silently monitors pages you visit
2. **AI detects trials** — Aion 1.0 Instruct (Edge built-in model) analyzes page text entirely on-device; your browsing data never leaves your computer
3. **Metadata saved** — only the extracted trial info (product name, end date) is sent to the secure Azure backend
4. **Email reminder** — 3 days before your trial ends, you receive an email with a cancellation link

## Tech Stack

| Layer | Technology |
|---|---|
| Browser Extension | Microsoft Edge (Manifest V3) |
| On-device AI | Aion 1.0 Instruct via Edge Prompt API (Build 2026) |
| Backend | Azure Functions (Node.js v4) |
| Database | Azure Cosmos DB (NoSQL) |
| Email | Azure Communication Services |
| Secrets | Azure Key Vault |
| IaC | Azure Bicep + `azd` |

## Hackathon Theme

**Agentic Web** — an autonomous agent that monitors browsing, uses AI to understand intent, and takes real-world action on the user's behalf.

---

## Prerequisites

- Node.js 20+
- Azure Functions Core Tools v4 (`npm i -g azure-functions-core-tools@4`)
- Azure Developer CLI (`winget install microsoft.azd`)
- Microsoft Edge 150.0.4070+ (Canary/Dev for Aion 1.0)
- An Azure subscription

---

## Local Development

### 1. Clone and install

```bash
git clone <repo-url>
cd hackerearthbuildai/backend
npm install
```

### 2. Configure environment

Copy `local.settings.json.example` to `local.settings.json` and fill in your values:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "COSMOS_ENDPOINT": "https://<account>.documents.azure.com:443/",
    "COSMOS_KEY": "<your-key>",
    "COSMOS_DATABASE": "trialguard",
    "COSMOS_CONTAINER": "trials",
    "ACS_CONNECTION_STRING": "<your-acs-connection-string>",
    "EMAIL_SENDER": "DoNotReply@<domain>.azurecomm.net",
    "BACKEND_URL": "http://localhost:7071"
  }
}
```

### 3. Start backend

```bash
cd backend
func start
```

### 4. Load extension in Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the TrialGuard icon → enter your email address

---

## Deploy to Azure

```bash
azd up
```

This provisions all Azure resources and deploys the Functions app in one command.

After deploy, update `extension/config.js` with the deployed Function App URL.

---

## Project Structure

```
hackerearthbuildai/
├── extension/          # Edge Manifest V3 extension
├── backend/            # Azure Functions (Node.js v4)
├── infrastructure/     # Bicep IaC templates
└── azure.yaml          # azd project definition
```

---

## Sample Free Trial Web App

The [`sample-free-trial-web-app/`](sample-free-trial-web-app/) directory contains a standalone ASP.NET Core web application designed to **test TrialGuard end-to-end without relying on real-world products** (e.g. Adobe, Microsoft 365 trials).

### What It Is

**NeuroRevive** — a fictional clinical brain research SaaS platform that simulates a realistic free trial sign-up flow. It gives TrialGuard a safe, controlled target page to detect, parse, and track.

### Why It Exists

Testing TrialGuard against real products is impractical — trials have limited slots, require credit cards, and can't be reset. This app provides a repeatable, local environment with known trial metadata so you can verify the full detection → reminder pipeline.

### Features

- 2-day free trial sign-up (no credit card required)
- Form collects First Name, Last Name, Email with server-side validation
- Duplicate email detection
- Trial expiry auto-calculated from sign-up time (UTC)
- Confirmation page with exact trial end date — the data TrialGuard should extract
- JSON file-based subscription persistence (`Data/subscriptions.json`)
- Docker support (port 8080)

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing page with hero, feature cards, and CTA |
| `/Subscribe` | Free trial sign-up form |
| `/ThankYou` | Confirmation with user name and trial expiry date |
| `/Privacy` | Privacy policy |

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | ASP.NET Core Razor Pages (.NET 10) |
| Frontend | Bootstrap 5, jQuery, Bootstrap Icons |
| Storage | JSON file (`~/Data/subscriptions.json`) |
| Container | Docker (ASP.NET 10 base image) |

### Running Locally

```bash
cd sample-free-trial-web-app
dotnet run
```

Then open `https://localhost:5001` (or the port shown in the terminal), navigate to `/Subscribe`, and complete the sign-up. The ThankYou page will display the trial expiry date — load the extension and confirm TrialGuard detects it correctly.

Or with Docker:

```bash
docker build -t neurorevive .
docker run -p 8080:8080 neurorevive
```

---

## Submission

- **Theme:** Agentic Web
- **Privacy model:** Page content analyzed 100% on-device by Aion 1.0 Instruct. Only metadata sent to cloud.
