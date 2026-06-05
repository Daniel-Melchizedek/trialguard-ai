// Runs on every page at document_idle.
// Uses Aion 1.0 Instruct (Edge Prompt API) — 100% on-device, no data sent to cloud.

const TRIAL_KEYWORDS = [
  "free trial", "start your trial", "start trial", "begin trial",
  "days free", "cancel anytime", "no credit card required",
  "try for free", "try free", "free for", "day free trial",
  "month free", "trial period", "trial subscription"
];

// URLs that strongly suggest a post-enrollment confirmation page
const CONFIRMATION_URL_PATTERNS = [
  /welcome/, /thank.?you/, /confirm/, /success/, /get.?started/,
  /dashboard/, /onboard/, /activated/, /subscri/, /checkout\/complete/,
  /order.?confirm/, /signup.?complete/, /register.?complete/
];

// Page text that strongly suggests the user has COMPLETED enrollment
// (not just browsing a trial landing page)
const CONFIRMATION_TEXT_SIGNALS = [
  "your trial has started",
  "your free trial is now active",
  "welcome to your trial",
  "trial is active",
  "you're all set",
  "you are all set",
  "your subscription has started",
  "trial activated",
  "you've been enrolled",
  "you have been enrolled",
  "enjoy your free",
  "your account is ready",
  "get started with your",
  "thank you for starting",
  "trial period begins",
  "days remaining in your trial"
];

let alreadyChecked = false;
let trialSent      = false;   // once true, never detect again on this page
let formSubmitDetected = false;

function hasTrialKeywords(text) {
  const lower = text.toLowerCase();
  return TRIAL_KEYWORDS.some(kw => lower.includes(kw));
}

function isConfirmationUrl() {
  const path = (window.location.pathname + window.location.href).toLowerCase();
  return CONFIRMATION_URL_PATTERNS.some(p => p.test(path));
}

function hasConfirmationText(text) {
  const lower = text.toLowerCase();
  return CONFIRMATION_TEXT_SIGNALS.some(s => lower.includes(s));
}

// Determine confidence that user actually enrolled (not just browsing)
function getEnrollmentSignals(pageText) {
  return {
    hasKeywords:      hasTrialKeywords(pageText),
    isConfirmUrl:     isConfirmationUrl(),
    hasConfirmText:   hasConfirmationText(pageText),
    formWasSubmitted: formSubmitDetected
  };
}

async function detectTrialWithAion(pageText, signals) {
  if (typeof LanguageModel === "undefined") {
    console.warn("[TrialGuard] LanguageModel API not available — requires Edge 150+ Canary/Dev with Aion 1.0");
    return null;
  }

  const availability = await LanguageModel.availability();
  console.log("[TrialGuard] Aion 1.0 model availability:", availability);

  if (availability === "unavailable") {
    console.warn("[TrialGuard] Aion 1.0 model unavailable on this device");
    return null;
  }
  if (availability !== "available") {
    console.warn("[TrialGuard] Aion 1.0 model not yet downloaded — open the TrialGuard popup to initialize it, then revisit this page");
    return null;
  }

  console.log("[TrialGuard] Aion 1.0 Instruct: creating session...");
  const today = new Date().toISOString().slice(0, 10);
  const session = await LanguageModel.create({ temperature: 0.2, topK: 10, expectedOutputLanguages: ["en"] });

  // Strict prompt: requires BOTH a success message AND a clear trial duration/end date
  const prompt = `You are a strict free trial enrollment detector. Today is ${today}.

Return detected:true ONLY when ALL THREE conditions are met:
  1. The page contains an explicit SUCCESS or ACTIVATION message — e.g.:
       "Your free trial has started", "Trial activated successfully",
       "Your trial is now active", "Welcome, your trial begins today",
       "You're now on a free trial", "Subscription started"
  2. The page explicitly states the trial duration or end date — e.g.:
       "7-day free trial", "trial ends on June 11", "valid until 2026-06-11",
       "your trial expires in 30 days", "free until July 4"
  3. This is clearly a POST-SIGNUP confirmation screen, NOT a marketing/pricing page.

Return detected:false if ANY of these is true:
  - Page is a landing/marketing page promoting a trial (user hasn't signed up yet)
  - Page is a signup or payment form
  - There is a success message but NO trial duration or end date is mentioned
  - The trial duration or end date is vague or missing

Return ONLY valid JSON, no markdown, no explanation.

If ALL THREE conditions met:
{"detected":true,"productName":"<exact product name>","trialDurationDays":<number>,"trialEndDate":"<YYYY-MM-DD only, e.g. 2026-06-11 — no time, no timezone, just the date>","websiteUrl":"${window.location.hostname}"}

Otherwise:
{"detected":false,"reason":"<no_success_message|no_end_date|landing_page|signup_form|unclear>"}

Webpage text (first 3000 chars):
${pageText.slice(0, 3000)}`;

  console.log("[TrialGuard] Sending prompt to Aion 1.0 (on-device, no cloud)...");
  const raw = await session.prompt(prompt);
  session.destroy();

  console.log("[TrialGuard] Aion 1.0 raw output:", raw);

  // Robust JSON extraction — handles extra trailing chars like "}}",  markdown, etc.
  function extractJSON(text) {
    const start = text.indexOf("{");
    if (start === -1) return null;
    const sub = text.slice(start);
    // Walk backwards from each closing brace until JSON.parse succeeds
    let pos = sub.lastIndexOf("}");
    while (pos >= 0) {
      try {
        return JSON.parse(sub.slice(0, pos + 1));
      } catch {
        pos = sub.lastIndexOf("}", pos - 1);
      }
    }
    return null;
  }

  const parsed = extractJSON(raw);
  if (parsed) {
    console.log("[TrialGuard] Parsed result:", parsed);
    return parsed;
  }
  console.error("[TrialGuard] Failed to parse Aion output as JSON:", raw);
  return null;
}

async function checkPage() {
  if (trialSent)      return;   // already confirmed a trial on this page — stop forever
  if (alreadyChecked) return;

  const pageText = document.body?.innerText || "";

  // Must have trial keywords AND at least one enrollment signal
  if (!hasTrialKeywords(pageText)) {
    console.log("[TrialGuard] No trial keywords on this page — skipping");
    return;
  }

  const signals = getEnrollmentSignals(pageText);
  const signalCount = [signals.isConfirmUrl, signals.hasConfirmText, signals.formWasSubmitted].filter(Boolean).length;

  console.log("[TrialGuard] Enrollment signals:", signals, "count:", signalCount);

  // Require at least ONE strong enrollment signal before calling AI
  // This prevents false positives on landing/marketing/pricing pages
  if (signalCount === 0) {
    console.log("[TrialGuard] No enrollment signals — looks like a landing page, skipping AI");
    return;
  }

  console.log("[TrialGuard] Enrollment signals detected — invoking Aion 1.0...");
  alreadyChecked = true;

  const result = await detectTrialWithAion(pageText, signals);
  if (!result || !result.detected) {
    console.log("[TrialGuard] Aion: not enrolled yet —", result?.reason || "unknown");
    return;
  }

  console.log(`[TrialGuard] ✓ Trial enrollment confirmed: ${result.productName}`);
  result.pageUrl   = window.location.href;
  result.pageTitle = document.title;

  // Lock — no further detections on this page regardless of future mutations
  trialSent = true;

  // Post to bridge.js (ISOLATED world) which has full chrome.* access
  window.postMessage({ type: "TRIALGUARD_DETECTED", payload: result }, "*");
  console.log("[TrialGuard] Dispatched to bridge via postMessage");
}

// ─── Form submit listener ────────────────────────────────────────────────────
// Strongest signal: user actually clicked "Start Trial" / "Subscribe"
document.addEventListener("submit", (e) => {
  const form = e.target;
  const formText = (form.innerText + form.innerHTML).toLowerCase();
  const isTrialForm = TRIAL_KEYWORDS.some(kw => formText.includes(kw)) ||
    ["signup", "sign-up", "register", "subscribe", "trial", "start"].some(w =>
      (form.action || "").toLowerCase().includes(w) ||
      (form.id   || "").toLowerCase().includes(w) ||
      (form.className || "").toLowerCase().includes(w)
    );
  if (isTrialForm) {
    console.log("[TrialGuard] Trial signup form submitted");
    formSubmitDetected = true;
    setTimeout(() => { alreadyChecked = false; checkPage(); }, 2000);
  }
}, true);

// ─── Initial page check ───────────────────────────────────────────────────────
checkPage();

// ─── Dynamic content observer ────────────────────────────────────────────────
// Fires when:
//  • URL changes (SPA navigation)
//  • A modal / dialog appears
//  • New content injected via AJAX/fetch contains confirmation signals
//  • An iframe loads new content

let lastUrl  = location.href;
let debounceTimer = null;

function extractAddedText(mutations) {
  return mutations
    .flatMap(m => Array.from(m.addedNodes))
    .filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE)
    .map(n => n.innerText || n.textContent || "")
    .join(" ");
}

function isModalOrDialog(mutations) {
  return mutations.some(m =>
    Array.from(m.addedNodes).some(n => {
      if (n.nodeType !== Node.ELEMENT_NODE) return false;
      const role = (n.getAttribute?.("role") || "").toLowerCase();
      const cls  = (n.className || "").toLowerCase();
      const id   = (n.id || "").toLowerCase();
      return role === "dialog" || role === "alertdialog" ||
        ["modal", "dialog", "popup", "overlay", "lightbox", "toast", "alert", "notification"]
          .some(w => cls.includes(w) || id.includes(w));
    })
  );
}

const observer = new MutationObserver((mutations) => {
  if (trialSent) return;   // already handled on this page

  // 1. SPA URL change — new page, allow fresh detection
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    alreadyChecked = false;
    trialSent      = false;
    formSubmitDetected = false;
    console.log("[TrialGuard] SPA navigation detected:", location.href);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkPage, 1500);
    return;
  }

  // 2. A modal / dialog was injected — check immediately
  if (isModalOrDialog(mutations)) {
    alreadyChecked = false;
    console.log("[TrialGuard] Modal/dialog appeared in DOM");
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkPage, 500);
    return;
  }

  // 3. New text injected that contains trial keywords OR confirmation signals
  const newText = extractAddedText(mutations);
  if (newText.length > 40) {
    const hasKeyword = hasTrialKeywords(newText);
    const hasConfirm = hasConfirmationText(newText);
    if (hasKeyword || hasConfirm) {
      alreadyChecked = false;
      console.log("[TrialGuard] Dynamic content with trial/confirmation text injected");
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkPage, 800);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true, characterData: false });

// ─── Iframe / frame monitoring ────────────────────────────────────────────────
// Some checkout/payment flows complete inside iframes (Stripe, PayPal, etc.)
function watchIframe(iframe) {
  try {
    iframe.addEventListener("load", () => {
      try {
        const iframeDoc  = iframe.contentDocument || iframe.contentWindow?.document;
        const iframeText = iframeDoc?.body?.innerText || "";

        if (hasTrialKeywords(iframeText) || hasConfirmationText(iframeText)) {
          console.log("[TrialGuard] Iframe loaded with trial/confirmation content:", iframeText.slice(0, 200));
          alreadyChecked = false;
          formSubmitDetected = true;
          setTimeout(checkPage, 800);
        }

        // Also observe mutations inside the iframe
        if (iframeDoc?.body) {
          new MutationObserver((muts) => {
            const newText = extractAddedText(muts);
            if (hasTrialKeywords(newText) || hasConfirmationText(newText)) {
              console.log("[TrialGuard] Iframe content changed with trial/confirmation text");
              alreadyChecked = false;
              formSubmitDetected = true;
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(checkPage, 800);
            }
          }).observe(iframeDoc.body, { childList: true, subtree: true });
        }
      } catch {
        // Cross-origin iframe — cannot read content (browser security restriction)
      }
    });
  } catch { /* ignore */ }
}

// Watch existing iframes
document.querySelectorAll("iframe").forEach(watchIframe);

// Watch iframes added dynamically
const iframeObserver = new MutationObserver(mutations => {
  mutations.flatMap(m => Array.from(m.addedNodes))
    .filter(n => n.nodeName === "IFRAME")
    .forEach(watchIframe);
});
iframeObserver.observe(document.body, { childList: true, subtree: true });

// ─── Native alert / confirm / prompt interception ─────────────────────────────
// Running in MAIN world so we can wrap these globals.
// Some sites use alert("Your trial has started!") or confirm("Trial activated").
(function interceptNativeDialogs() {
  const _alert   = window.alert.bind(window);
  const _confirm = window.confirm.bind(window);

  window.alert = function(msg) {
    const text = String(msg || "");
    if (hasTrialKeywords(text) || hasConfirmationText(text)) {
      console.log("[TrialGuard] alert() contains trial/confirmation text:", text);
      alreadyChecked = false;
      formSubmitDetected = true;
      setTimeout(checkPage, 300);
    }
    return _alert(msg);
  };

  window.confirm = function(msg) {
    const text = String(msg || "");
    if (hasTrialKeywords(text) || hasConfirmationText(text)) {
      console.log("[TrialGuard] confirm() contains trial/confirmation text:", text);
      alreadyChecked = false;
      formSubmitDetected = true;
      setTimeout(checkPage, 300);
    }
    return _confirm(msg);
  };
})();

// ─── postMessage listener ─────────────────────────────────────────────────────
// SPAs and payment iframes often signal completion via postMessage
window.addEventListener("message", (e) => {
  try {
    const text = typeof e.data === "string"
      ? e.data
      : JSON.stringify(e.data || "");
    if (hasTrialKeywords(text) || hasConfirmationText(text)) {
      console.log("[TrialGuard] postMessage with trial/confirmation content:", text.slice(0, 200));
      alreadyChecked = false;
      formSubmitDetected = true;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkPage, 800);
    }
  } catch { /* ignore */ }
});
