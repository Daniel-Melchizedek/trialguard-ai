# Trial Guard — AI‑powered free‑trial companion & autonomous canceller

> **Trial Guard** detects free‑trial sign‑ups as you browse — analyzing page content **100% on‑device** with [**Aion‑1.0‑Instruct**](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api#the-aion-10-instruct-model) — **Microsoft's** on‑device small language model (SLM) on Windows — then sends you a daily **AI‑generated tip** so you get full value from every day of your trial. If you ever decide the trial isn't for you, Trial Guard can **autonomously cancel** the subscription on your behalf — no hunting through settings, no surprise charges.
>
> **Theme: Agentic Web** — an agent that watches your browsing, understands intent with on‑device AI, and takes real action on your behalf.

---

## Demo

| **Video** | **Description** |
|---|---|
| [Extension walkthrough 🎥](<video_link1>) | See Trial Guard detect a free-trial sign-up in Edge, send daily AI-generated tips to help you get the most out of your trial, and — when you choose to cancel — autonomously complete the cancellation using the on-device Aion-1.0-Instruct model. |
| [Setup guide 🎥](<video_link2>) | How to load the unpacked extension in Microsoft Edge Developer mode and enable the required Aion on-device model settings. |

---

## 1. Project Description

Free trials are packed with value — but only if you use them. Trial Guard helps you get the most from every trial day with AI‑generated tips, and if you decide it's not the right fit, can cancel the subscription autonomously on your behalf:

- **Detect** — As you browse, the Edge extension reads the page on‑device with **Aion‑1.0‑Instruct** (Edge Prompt API `LanguageModel`) and decides whether you've started a time‑limited *free trial* (vs a permanent free plan), extracting the product name and end date. Your full page content never leaves the device — only a small set of extracted metadata is sent to the backend (see §6 Data Privacy).
- **Maximise your trial** — An Azure Functions backend stores the trial and emails you a daily **AI‑generated tip** — grounded in live web context — to help you discover features and get full value from the product throughout the trial period. Each email also includes a countdown and a "Manage subscription" link so you're always in control.
- **Cancel autonomously, if you choose** — From the popup you launch a **side‑panel agent** that opens the product's account page and works through the cancellation flow on its own: *observe the page → ask Aion for the next action → click/select → repeat*. It chooses survey reasons, declines retention offers ("No thanks"), and **pauses for you to type your password** (it never auto‑fills credentials). You can hit **Stop** at any time.

A bundled **sample web app ("Neuro Revive")** is included so you can test **trial activation and cancellation through the extension without signing up for any real trials that require payment information** — no real product, no credit card, fully repeatable.

---

## 2. Architecture Overview

![Trial Guard — Azure Architecture](architecture-diagram/Trial%20Guard%20%E2%80%94%20Azure%20Architecture.png)

> To explore the diagram interactively (clickable nodes, hover details), [click here](https://daniel-melchizedek.github.io/trialguard-ai/architecture-diagram/interactive-architecture-diagram.html).

```
 Browser (Microsoft Edge 150+ with Aion‑1.0‑Instruct, on Windows)
 ┌──────────────────────────────────────────────────────────┐
 │ Extension (Manifest V3)                                   │
 │  content.js (MAIN world) ──on‑device Aion detection──┐    │
 │        │ window.postMessage                          │    │
 │  bridge.js (ISOLATED) ── chrome.storage.sync ────────┘    │
 │        │ chrome.runtime                                    │
 │  background.js (service worker)                            │
 │   • saves trial to backend                                │
 │   • cancellation AGENT loop (chrome.scripting, allFrames, │
 │     Aion picks next action, password gate, Stop)          │
 │  UIs: popup · sidepanel (live log/timer/verbose) · download│
 └───────────────┬───────────────────────────────────────────┘
                 │ HTTPS (trial metadata + status)
 ┌───────────────▼───────────────────────────────────────────┐
 │ Azure Functions backend (Node ≥ 22)                        │
 │  saveTrial (HTTP)   → Cosmos DB + Day‑1 email              │
 │  checkTrials (timer 0 0 9 * * * UTC) → daily reminders      │
 │  patchTrial (HTTP)  → cancellation‑status updates          │
 │  emailClient → Azure Communication Services (email)        │
 │  aiClient/agentClient → Azure AI Foundry Agent (tips)      │
 │  webRetriever → site scrape + Bing fallback (tip grounding)│
 └───────────────┬───────────────────────────────────────────┘
   Cosmos DB · Communication Services · AI Foundry (gpt‑4o‑mini) · Key Vault
   (provisioned with Bicep + azd — see infrastructure/ and azure.yaml)
```

| Component | Path | Responsibility |
|---|---|---|
| Content script | `extension/content.js` | On‑device Aion trial detection (MAIN world) |
| Bridge | `extension/bridge.js` | ISOLATED‑world `chrome.*` access; dedupe + persist to `storage.sync` |
| Service worker | `extension/background.js` | Backend save + the autonomous cancellation agent loop |
| Popup | `extension/popup/` | Detected trials, Cancel/Retry, AI‑model download entry |
| Side panel | `extension/sidepanel/` | Live cancellation log, elapsed timer, Verbose prompt view, Stop |
| Download page | `extension/download/` | Guided on‑device Aion model download |
| Backend | `backend/` | Azure Functions: `saveTrial`, `checkTrials`, `patchTrial` + utils |
| Sample app | `sample-free-trial-web-app/` | .NET 10 test harness for activation + cancellation |
| Infra | `infrastructure/`, `azure.yaml` | Bicep + `azd` resource provisioning |

---

## 3. AI Tools Used

| Where | Tool / model | Purpose | Cloud? |
|---|---|---|---|
| Trial detection (`content.js`) | **Aion‑1.0‑Instruct** — on‑device SLM (Windows / Microsoft Edge), Prompt API `LanguageModel` | Classify *free trial* vs *free plan*; extract product name + end date | No (on‑device) |
| Cancellation agent (`background.js`) | **Aion‑1.0‑Instruct** — on‑device SLM (Windows / Microsoft Edge) | Pick the next action from the page's accessibility tree; confirm cancellation succeeded | No (on‑device) |
| Email tips (`agentClient.js`) | **Azure AI Foundry Agents v2** (`@azure/ai-projects`, agent `trialguard-tip-agent`, model `gpt-4o-mini`, `web_search_preview` tool) | Generate a 1–2 sentence actionable product tip | Yes |
| Tip grounding (`webRetriever.js`) | **Bing Search** (fallback) | Fetch product context when the site scrape is thin | Yes |

Development was assisted by AI coding tools such as **GitHub Copilot**.

> **Aion‑1.0‑Instruct** is Microsoft's prerelease on‑device SLM built into Microsoft Edge (Edge 150.0.4070+, Windows). Refs: [Microsoft Edge Prompt API — the Aion‑1.0‑Instruct model](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api#the-aion-10-instruct-model) · [Build 2026 — Windows as the trusted platform for development](https://blogs.windows.com/windowsdeveloper/2026/06/02/build-2026-furthering-windows-as-the-trusted-platform-for-development/).

---

## 4. Setup Instructions

**Prerequisites:** Windows · Microsoft Edge **150.0.4070+** (Canary/Dev with the on‑device **Aion‑1.0‑Instruct** model enabled) · **Node.js ≥ 22** · Azure Functions Core Tools v4 (`npm i -g azure-functions-core-tools@4`) · Azure Developer CLI (`winget install microsoft.azd`) · .NET 10 SDK (for the sample app) · an Azure subscription.

```bash
git clone https://github.com/Daniel-Melchizedek/trialguard-ai.git
cd trialguard-ai
```

**a) Extension** — Open `edge://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder → open the Trial Guard popup → click **⬇️ Download AI model** (one‑time on‑device download) → set your email on the **Settings** page. *(The backend URL is preconfigured/committed by default — no need to set it.)*

**b) Backend (local)**
```bash
cd backend
npm install
cp local.settings.json.example local.settings.json   # then fill in the values below
func start                                            # http://localhost:7071
```
Required app settings / env vars: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE` (default `trialguard`), `COSMOS_CONTAINER` (default `trials`), `ACS_CONNECTION_STRING`, `EMAIL_SENDER`, `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` (default `gpt-4o-mini`), and optionally `BING_SEARCH_KEY`. (Azure AI Foundry auth uses `DefaultAzureCredential` — run `az login` locally.)

**c) Sample app** — test activation + cancellation without any real trial:
```bash
cd sample-free-trial-web-app
dotnet run                          # https://localhost:5001
# or: docker build -t neurorevive . && docker run -p 8080:8080 neurorevive
```
Sign up on `/Subscribe`, land on `/ThankYou` (the extension detects the trial), then use the popup's **Cancel Trial** to watch the agent cancel it on `/Cancel`.

**d) Deploy to Azure**
```bash
azd up        # provisions Cosmos DB, Communication Services, AI Foundry, Key Vault + deploys the Functions app
```

---

## 5. Dependencies

| Area | Key dependencies |
|---|---|
| **Extension** | Manifest V3, vanilla JS (no build/npm). Requires Windows + Edge 150+ with the on‑device **Aion‑1.0‑Instruct** model. Permissions: `storage`, `scripting`, `activeTab`, `tabs`, `sidePanel`, host `<all_urls>`. |
| **Backend** | Node ≥ 22 · `@azure/functions ^4.5` · `@azure/cosmos ^4.1` · `@azure/communication-email ^1.0` · `@azure/identity ^4.4` · `@azure/ai-projects ^2.0` · `cheerio ^1.0`. Azure Functions Core Tools v4; Bicep + `azd` for IaC. |
| **Sample app** | .NET 10 · ASP.NET Core Razor Pages · Bootstrap 5 · Docker (`mcr.microsoft.com/dotnet/aspnet:10.0`). |

---

## 6. Data Privacy

### On‑device processing

All page content is read and classified entirely on‑device by **Aion‑1.0‑Instruct** running inside Microsoft Edge. No page text, HTML, or screenshots are ever transmitted to Trial Guard's backend or any external service.

### Metadata collected and stored in Cosmos DB

| Field | Value | Purpose |
|---|---|---|
| `productName` | Name of the detected product or service | Identify the trial; shown in reminder emails |
| `trialEndDate` / `trialDurationDays` | Trial expiry date or length in days | Calculate when to send daily reminders and the 3‑day pre‑expiry alert |
| `websiteUrl` | URL of the page where the trial was detected | Provide context in reminder emails |
| `pageTitle` | Title of that page | Provide context in reminder emails |
| `userEmail` | Email address entered in the extension's Settings page | Send daily reminder emails; never shared with third parties |
| `detectedAt` | Timestamp of when the trial was first detected | Determine the trial timeline and reminder schedule |

If you choose to cancel a trial, the following additional fields are written to the same record:

| Field | Purpose |
|---|---|
| `cancellationStatus` | Track whether cancellation is in progress, succeeded, or failed |
| `cancellationStartedAt` / `cancellationCompletedAt` | Record the cancellation timeline |
| `cancellationError` | Capture any error message if cancellation does not complete |

### What is never collected

- Full page content, HTML, or screenshots
- Browsing history beyond the detected trial page
- Passwords or credentials — the cancellation agent always pauses and waits for you to type these manually; they are never read, stored, or transmitted

---

## 7. Team Members & Roles

| Name | Role | Contributions |
|---|---|---|
| **Daniel Melchizedek Arockia Thomas Samuel** | Full‑stack Developer & Project Lead | Edge extension (on‑device Aion detection + autonomous cancellation agent, popup/side‑panel/download UIs), Azure Functions backend, Azure AI Foundry tip agent, .NET sample app, and Bicep/`azd` infrastructure. |

---

**Repository:** https://github.com/Daniel-Melchizedek/trialguard-ai · **Theme:** Agentic Web · **Privacy:** page content is analyzed entirely on‑device by **Aion‑1.0‑Instruct** and never leaves your device — see §6 Data Privacy for full details on what is collected and why.
