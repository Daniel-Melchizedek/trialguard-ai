// Service worker — handles trial detections and automated cancellation

// Swallow benign rejections from tabs that close / navigate to error pages mid-operation
// (these are expected during autonomous navigation and shouldn't surface as uncaught errors).
self.addEventListener("unhandledrejection", (event) => {
  const msg = String(event.reason?.message || event.reason || "");
  if (/No tab with id|Frame with ID|showing error page|No frame with id|cannot be scripted|Cannot access|chrome:\/\/|edge:\/\/|message channel closed|Receiving end does not exist/i.test(msg)) {
    event.preventDefault();
  }
});

const CONFIG = { BACKEND_URL: "https://tgprod-func-l2344akjnhcmu.azurewebsites.net" };

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(["userEmail", "backendUrl"], data => {
      resolve({
        userEmail: data.userEmail || null,
        backendUrl: data.backendUrl || CONFIG.BACKEND_URL
      });
    });
  });
}

// ─── Trial detection ──────────────────────────────────────────────────────────

async function saveTrial(trialData, userEmail, backendUrl) {
  const payload = {
    userEmail,
    productName: trialData.productName,
    trialDurationDays: trialData.trialDurationDays,
    trialEndDate: trialData.trialEndDate,
    websiteUrl: trialData.websiteUrl || trialData.pageUrl,
    pageTitle: trialData.pageTitle
  };
  const resp = await fetch(`${backendUrl}/api/save-trial`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
  return resp.json();
}

async function storeLocalTrial(trialData, userEmail) {
  return new Promise(resolve => {
    chrome.storage.sync.get(["trials"], data => {
      const trials = data.trials || [];
      trials.unshift({
        id: crypto.randomUUID(),
        userEmail,
        productName: trialData.productName,
        trialEndDate: trialData.trialEndDate,
        trialDurationDays: trialData.trialDurationDays,
        websiteUrl: trialData.websiteUrl || trialData.pageUrl,
        detectedAt: new Date().toISOString()
      });
      chrome.storage.sync.set({ trials: trials.slice(0, 50) }, resolve);
    });
  });
}

// ─── Cancellation — state ─────────────────────────────────────────────────────

const _abortControllers = new Map();

let _traceBuf = [];
function notifySP(type, payload) {
  chrome.runtime.sendMessage({ action: "spUpdate", type, payload }).catch(() => {});
  // DEBUG: mirror progress to storage via an in-memory buffer (no get→set race),
  // since runtime.sendMessage from the SW does not reach content scripts.
  try {
    _traceBuf.push({ ts: Date.now(), type, payload });
    if (_traceBuf.length > 300) _traceBuf = _traceBuf.slice(-300);
    chrome.storage.local.set({ tgTrace: _traceBuf }).catch(() => {});
  } catch {}
}

function spToast(type, message, trialId) {
  notifySP("toast", { type, message, trialId });
}

// ─── Cancellation — backend patch ─────────────────────────────────────────────

async function patchTrialRemote(id, userEmail, fields, backendUrl) {
  const resp = await fetch(`${backendUrl}/api/patch-trial`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, userEmail, ...fields }),
    signal: AbortSignal.timeout(5000)
  });
  if (!resp.ok) throw new Error(`Patch failed: ${resp.status}`);
}

async function updateLocalTrial(trialId, fields) {
  return new Promise(resolve => {
    chrome.storage.sync.get(["trials"], data => {
      const trials = (data.trials || []).map(t =>
        t.id === trialId ? { ...t, ...fields } : t
      );
      chrome.storage.sync.set({ trials }, resolve);
    });
  });
}

// ─── Cancellation — page observation ─────────────────────────────────────────

// URLs that chrome.scripting.executeScript cannot inject into.
const RESTRICTED_URL_RE = /^(chrome|edge|about|devtools|view-source|chrome-error|chrome-extension|moz-extension|data):|^https?:\/\/(chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i;

// Is this tab safe to script right now? Returns { ok, gone, restricted, url }.
// Used to guard every observe/act so we never spin on a closed or restricted tab.
async function tabScriptability(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, gone: true };
  }
  const url = tab.url || tab.pendingUrl || "";
  if (!/^https?:\/\//i.test(url) || RESTRICTED_URL_RE.test(url)) {
    return { ok: false, restricted: true, url };
  }
  return { ok: true, url };
}

async function observePage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },   // include cross-origin iframes (e.g. plan.adobe.com survey)
      world: "MAIN",
      func: () => {
        // Gather page text INCLUDING shadow DOM (account.adobe.com renders the survey,
        // "We're sorry to see you go", etc. inside web-component shadow roots that are
        // NOT included in document.body.innerText).
        function deepText() {
          const parts = [document.body?.innerText || ""];
          const seen = new Set();
          (function walk(root, depth) {
            if (depth > 10) return;
            let all = [];
            try { all = root.querySelectorAll("*"); } catch {}
            for (const el of all) {
              if (el.shadowRoot && !seen.has(el.shadowRoot)) {
                seen.add(el.shadowRoot);
                parts.push(el.shadowRoot.textContent || "");
                walk(el.shadowRoot, depth + 1);
              }
            }
          })(document, 0);
          return parts.join(" ").replace(/\s+/g, " ").trim();
        }
        const bodyText = deepText();
        const sel = ['button','a[href]','input','textarea','select','label',
                     '[role="button"]','[role="link"]','[role="radio"]','[role="option"]',
                     '[role="menuitemradio"]','[role="checkbox"]','[role="tab"]','[role="menuitem"]',
                     '[tabindex]','[onclick]',
                     'sp-button','sp-radio','sp-checkbox','sp-menu-item','sp-action-button',
                     'sp-action-menu','sp-link'].join(",");

        // Collect matching elements across the light DOM AND open shadow roots
        // (modern portals like account.adobe.com render controls inside web components).
        function deepQueryAll(selector) {
          const out = [];
          const seen = new Set();
          (function walk(root) {
            let matches = [];
            try { matches = root.querySelectorAll(selector); } catch {}
            for (const el of matches) { if (!seen.has(el)) { seen.add(el); out.push(el); } }
            let all = [];
            try { all = root.querySelectorAll("*"); } catch {}
            for (const el of all) { if (el.shadowRoot) walk(el.shadowRoot); }
          })(document);
          return out;
        }

        const visible = deepQueryAll(sel).filter(el => {
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
        });
        // Cancellation-relevant elements must survive the cap even if they appear late in
        // DOM order (e.g. plan cards rendered in shadow DOM after lots of nav/footer links).
        const RELEVANT = /manage|cancel|end\b|plan|subscription|membership|trial|account|continue|proceed|confirm|next\b|submit|renew|billing|payment|expensive|complicated|technical|completed|not using|change my plan|another membership|didn'?t work|experience|sorry/i;
        const labelOf = el => (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || "").trim();
        const relevant = visible.filter(el => RELEVANT.test(labelOf(el)));
        const others   = visible.filter(el => !RELEVANT.test(labelOf(el)));
        const allVisible = [...relevant, ...others].slice(0, 60);

        // Stamp each element with a unique index so Aion always gets a working selector
        allVisible.forEach((el, i) => el.setAttribute("data-tg-i", String(i)));

        const elements = allVisible.map((el, i) => {
            // Combine all text sources so the model can read hover text, alt, aria-label etc.
            const labelParts = [
              el.getAttribute("aria-label"),
              el.getAttribute("title"),
              el.querySelector("img")?.getAttribute("alt"),
              el.innerText,
              el.value,
              el.getAttribute("placeholder")
            ].map(s => (s || "").trim().replace(/\s+/g, " ")).filter(Boolean);
            const label = [...new Set(labelParts)].join(" | ").slice(0, 120);
            const aria = (el.getAttribute("aria-label") || "").toLowerCase();
            const cls  = (el.className || "").toLowerCase();
            const imgAlt = (el.querySelector("img")?.alt || el.querySelector("img")?.src || "").toLowerCase();
            const isProfile = /\baccount\b|manage.{0,4}account|my.{0,4}account|account.{0,4}setting/.test(aria + " " + cls + " " + imgAlt + " " + label.toLowerCase());

            // Surrounding context so the model understands where this element sits
            const parentText = (el.parentElement?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 120);
            // Nearest preceding heading — walk up ancestors, then back through previous siblings
            let nearbyHeading = "";
            const isHeading = n => n && (/^H[1-4]$/.test(n.tagName) || n.getAttribute?.("role") === "heading");
            outer: for (let anc = el; anc && anc !== document.body; anc = anc.parentElement) {
              for (let sib = anc.previousElementSibling; sib; sib = sib.previousElementSibling) {
                if (isHeading(sib)) { nearbyHeading = (sib.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80); break outer; }
                const h = sib.querySelector?.("h1,h2,h3,h4,[role=heading]");
                if (h) { nearbyHeading = (h.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80); break outer; }
              }
            }
            const menuTrigger = el.getAttribute("aria-haspopup") != null || el.getAttribute("aria-expanded") != null;
            const tlc = (el.getAttribute("type") || "").toLowerCase();
            const rlc = (el.getAttribute("role") || "").toLowerCase();
            const isOption = ["checkbox", "radio"].includes(tlc)
                          || ["checkbox", "radio", "option", "menuitemradio"].includes(rlc)
                          || (el.tagName === "LABEL" && !!el.querySelector('input[type="checkbox"],input[type="radio"]'));
            return {
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute("type") || "",
              role: el.getAttribute("role") || "",
              label,
              selector: `[data-tg-i=${i}]`,
              disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"),
              isProfile: !!isProfile,
              menuTrigger: !!menuTrigger,
              isOption: !!isOption,
              parentText,
              nearbyHeading
            };
          })
          .filter(e => e.label || e.isProfile);

        // ── Accessibility-tree reading (how a screen reader consumes the page) ──
        // Computes role + accessible name + state per node in reading order, incl. shadow
        // DOM, skipping aria-hidden/presentational nodes. Mirrors the W3C accname algorithm
        // (as in dom-accessibility-api / Playwright's accessibility snapshot).
        function a11yRead() {
          const out = [];
          const seenName = new Set();
          const rootNodeOf = (el) => el.getRootNode?.() || document;
          function refText(el, attr) {
            const ids = (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
            const root = rootNodeOf(el);
            return ids.map(id => {
              const r = (root.getElementById && root.getElementById(id)) || document.getElementById(id);
              return r ? (r.innerText || r.textContent || "").trim() : "";
            }).filter(Boolean).join(" ").trim();
          }
          function accName(el) {
            let n = refText(el, "aria-labelledby"); if (n) return n;
            n = (el.getAttribute("aria-label") || "").trim(); if (n) return n;
            const tag = el.tagName.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") {
              let lab = el.closest("label");
              if (!lab && el.id) { const root = rootNodeOf(el); lab = root.querySelector && root.querySelector(`label[for="${CSS.escape(el.id)}"]`); }
              if (lab) { const t = (lab.innerText || "").trim(); if (t) return t; }
              const ph = (el.getAttribute("placeholder") || "").trim(); if (ph) return ph;
              const v = (el.value || "").trim(); if (v && el.type !== "password") return v;
              return "";
            }
            if (tag === "img") return (el.getAttribute("alt") || "").trim();
            const txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
            if (txt) return txt.slice(0, 160);
            return (el.getAttribute("title") || "").trim();
          }
          function roleOf(el) {
            const explicit = el.getAttribute("role"); if (explicit) return explicit.trim();
            const tag = el.tagName.toLowerCase();
            if (tag === "a") return el.hasAttribute("href") ? "link" : "";
            if (tag === "button") return "button";
            if (tag === "select") return "combobox";
            if (tag === "textarea") return "textbox";
            if (/^h[1-6]$/.test(tag)) return "heading";
            if (tag === "img") return "img";
            if (tag === "input") {
              const t = (el.getAttribute("type") || "text").toLowerCase();
              return ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider", search: "searchbox", email: "textbox", tel: "textbox", url: "textbox", text: "textbox", password: "textbox" })[t] || "textbox";
            }
            return "";
          }
          function stateOf(el, role) {
            const parts = [];
            if (role === "checkbox" || role === "radio") {
              const ck = el.getAttribute("aria-checked");
              const checked = ck != null ? ck === "true" : !!el.checked;
              parts.push(checked ? "checked" : "not checked");
            }
            if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
            const exp = el.getAttribute("aria-expanded"); if (exp != null) parts.push(exp === "true" ? "expanded" : "collapsed");
            if (el.getAttribute("aria-selected") === "true") parts.push("selected");
            const pressed = el.getAttribute("aria-pressed"); if (pressed === "true") parts.push("pressed");
            // NVDA-style extra states
            if (el.getAttribute("aria-required") === "true" || el.required) parts.push("required");
            if (el.getAttribute("aria-busy") === "true") parts.push("busy");
            if (el.getAttribute("aria-invalid") === "true") parts.push("invalid");
            const cur = el.getAttribute("aria-current"); if (cur && cur !== "false") parts.push("current");
            const hp = el.getAttribute("aria-haspopup"); if (hp && hp !== "false") parts.push("has menu");
            return parts.length ? " (" + parts.join(", ") + ")" : "";
          }
          function hidden(el) {
            if (el.getAttribute("aria-hidden") === "true") return true;
            const r = el.getAttribute("role"); if (r === "presentation" || r === "none") return true;
            const s = window.getComputedStyle(el);
            return s.visibility === "hidden" || s.display === "none";
          }
          const SKIP_ROLES = new Set(["group","region","generic","none","presentation","list","listitem","article","document","main","banner","contentinfo","navigation","complementary","form","search","section","tablist","toolbar","dialog","alertdialog","status"]);
          (function walk(node, depth) {
            if (depth > 40) return;
            for (const el of node.children || []) {
              if (hidden(el)) continue;
              const role = roleOf(el);
              if (role && !SKIP_ROLES.has(role)) {
                const name = accName(el);
                if (name || role === "heading") {
                  const key = role + "|" + name;
                  if (!seenName.has(key)) { seenName.add(key); out.push(`${role} "${name}"${stateOf(el, role)}`); }
                }
              }
              if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
              walk(el, depth + 1);
            }
          })(document.body || document.documentElement, 0);
          return out.join("\n").slice(0, 3500);
        }

        return { url: location.href, title: document.title, text: bodyText.slice(0, 4500), a11y: a11yRead(), elements };
      }
    });
    // Merge every frame's result. Each frame stamps its own data-tg-i indices, so we record
    // the frameId on each element and target clicks at that specific frame.
    const merged = { url: "", title: "", text: "", a11y: "", elements: [] };
    for (const fr of results || []) {
      const res = fr?.result; if (!res) continue;
      const fid = fr.frameId || 0;
      for (const e of (res.elements || [])) { e.frameId = fid; merged.elements.push(e); }
      if (res.text) merged.text += (merged.text ? " " : "") + res.text;
      if (res.a11y) merged.a11y += (merged.a11y ? "\n" : "") + res.a11y;
      if (fid === 0) { merged.url = res.url; merged.title = res.title; }
    }
    if (!merged.url && results?.[0]?.result) { merged.url = results[0].result.url; merged.title = results[0].result.title; }
    merged.text = merged.text.slice(0, 6000);
    return merged;
  } catch (e) {
    const msg = e?.message || "";
    // Classify expected/transient failures so the loop can react instead of spinning:
    //  - tabGone:    the working tab was closed mid-run  → stop the cancellation
    //  - restricted: navigated to chrome://, edge://, etc → can't script; recover/stop
    //  - errorPage:  a browser error page                → goBack/reload recovery
    const tabGone    = /No tab with id|No tab|tab was closed/i.test(msg);
    const restricted = /Cannot access|cannot be scripted|chrome:\/\/|edge:\/\//i.test(msg);
    const errorPage  = /error page|Frame with ID/i.test(msg) || restricted;
    // These are expected during autonomous navigation — log quietly, don't spam as errors.
    if (tabGone || restricted || errorPage) console.debug("[TrialGuard] observePage skipped:", msg);
    else console.error("[TrialGuard] observePage failed:", e);
    return { url: "", title: "", text: "", a11y: "", elements: [], errorPage, tabGone, restricted };
  }
}

// Detect whether the page is asking for a password to proceed (re-auth before cancelling).
// We NEVER auto-fill passwords — instead we pause and let the user type it. Returns
// { present, filled }: present = a visible password field exists; filled = user has typed one.
async function detectPasswordPrompt(tabId, observation) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, world: "MAIN",
      func: () => {
        function deepAll(sel) {
          const out = [], seen = new Set();
          (function w(root) {
            let m = []; try { m = root.querySelectorAll(sel); } catch {}
            for (const el of m) { if (!seen.has(el)) { seen.add(el); out.push(el); } }
            let a = []; try { a = root.querySelectorAll("*"); } catch {}
            for (const el of a) { if (el.shadowRoot) w(el.shadowRoot); }
          })(document);
          return out;
        }
        // Adobe's auth field isn't always input[type=password] (Spectrum / show-password
        // toggling). Match by type, autocomplete, or name/id too.
        const fields = deepAll('input[type="password"],input[autocomplete="current-password"],input[autocomplete="password"],input[name*="password" i],input[id*="password" i],input[aria-label*="password" i]').filter(el => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
        });
        return { fieldExists: fields.length > 0, filled: fields.some(el => (el.value || "").length > 0) };
      }
    });
    const res = (r || []).map(f => f?.result).filter(Boolean)
      .reduce((acc, x) => ({ fieldExists: acc.fieldExists || x.fieldExists, filled: acc.filled || x.filled }), { fieldExists: false, filled: false });
    // Require an actual visible password field (broadened detection above) to pause — so we
    // don't false-fire on pages that merely have a "Reset your password" footer link.
    const txt = `${observation?.a11y || ""} ${observation?.text || ""}`.toLowerCase();
    const textSays = /enter (your )?(adobe )?password|verify (your )?identity|sign ?in to continue/.test(txt);
    return { present: res.fieldExists, filled: res.filled, textSays };
  } catch {
    return { present: false, filled: false, textSays: false };
  }
}

// ─── Cancellation — Aion prompt ───────────────────────────────────────────────

function stepResultLabel(result) {
  if (!result) return "pending";
  if (result.urlChanged) return "navigated";
  if (result.pageChanged) return "changed";
  return "no effect";
}

// Keywords that mark an element as a cancellation-relevant candidate.
// (No "profile" — avatar/profile menus pull the agent away from the cancel flow.)
const CANCEL_KEYWORDS = /\baccount\b|billing|subscription|subscribe|\bplan\b|plans|manage|cancel|trial|member|setting|continue|confirm|proceed|next|payment|renew/i;

// Junk links that look relevant but are dead ends or wrong direction (help articles,
// legal, FAQs, footer, account-security, upsell/renew, files, navigation back to marketing).
const JUNK_KEYWORDS = /adchoices|cookie|privacy|terms|conditions|legal|agreement|policy|do not sell|change region|learn more|faq|review top|what should i|how do i\b|how-?to|troubleshoot|help center|help with|contact us|support|community|opt.?out|^learn |social sign|sign ?in|renew|extend|navigation menu|opens file|\.pdf|download|install|redemption|storage|files or folders|^adobe\.com|view support|orders and invoices|activated devices|communication preferences|notifications|change payment|view billing|billing history|update payment|payment method|edit payment|add payment|keep your plan|keep my plan|keep my trial|close dialog|^close$|^user$|^help$|^previous$|change email|change password|edit profile|personal profile|account and security|profile information|manage account|manage your account|reset your password|stay signed in|remember.?me|show password/i;

// On a cancellation "reason" survey, prefer a benign reason (avoids retention upsells).
const PREFERRED_CANCEL_REASON = /needed the product|project i.{0,3}ve since completed|since completed|no longer (need|using)|not using the product|completed/i;

// Rank a candidate by how directly it advances cancellation (higher = earlier in menu).
// The model favours earlier options, so we surface the most relevant ones first.
function cancelRelevance(e) {
  const s = `${e.label} ${e.nearbyHeading}`.toLowerCase();
  // Dead ends / wrong-direction links (legal, account-security, upsell) → not actions.
  if (/terms|conditions|policy|agreement|legal|social sign|renew|extend/.test(s)) return 0;
  // A benign cancellation-survey reason (so it's selected before "Continue").
  if (PREFERRED_CANCEL_REASON.test(s)) return 6;
  // Direct cancellation actions.
  if (/cancel|end.?(your )?(free )?(trial|membership|subscription)|terminate|close.?account/.test(s)) return 5;
  // The "Manage plan" / "Manage subscription" button (the real path to cancel).
  if (/manage[^a-z]{0,3}(plan|subscription|membership|trial)/.test(s)) return 5;
  // Subscription/billing surfaces (but not security/upsell, handled above).
  if (/subscription|billing|\bmembership\b|payment method|plans? (and|&) payment/.test(s)) return 4;
  // A header profile/avatar menu trigger ("<name> Account" with aria-haspopup/expanded) just
  // opens a dropdown — it's not the plan path. Demote so the agent doesn't toggle it.
  if (e.menuTrigger && /\baccount\b|profile/.test(s) && !/manage/.test(s)) return 1;
  // Account navigation to reach the plan management area (not bare profile/avatar).
  if (/manage your account|manage account|\baccount\b|my.?account/.test(s)) return 3;
  if (/confirm|continue|proceed|next|done|finish/.test(s)) return 2;
  if (/\bplan\b|plans/.test(s)) return 1;
  return 0;
}

// Build a SHORT NUMBERED MENU of cancellation-relevant candidates + control options.
// Validated findings:
//   1. This on-device model copies any example selector/value in the prompt verbatim,
//      so we give NO example and ask for ONLY a number; code maps number → element.
//   2. With a long menu (~30 items) the model picks unreliably; with a short keyword-
//      filtered shortlist it picks correctly and consistently.
function buildMenuPrompt(trial, observation, stepsTaken, avoid = new Set()) {
  const stepsSummary = stepsTaken.length
    ? stepsTaken.slice(-8).map((s, idx) =>
        `  ${idx + 1}. ${s.action} "${s.description || ""}" on ${s.url.split("?")[0]} → ${stepResultLabel(s.result)}`
      ).join("\n")
    : "  (none yet)";

  const elemBlob = observation.elements.map(e => e.label).join(" | ").toLowerCase();
  const fullBlob = `${(observation.text || "").toLowerCase()} ${elemBlob}`;
  const CONTINUE = /\b(continue|proceed|next|submit|confirm|done|finish|complete)\b/i;
  // Backward / abort / off-path actions we must never click (keep plan, go back, close, profile).
  const BACKWARD = /manage plan|manage subscription|manage account|manage your account|cancel your (free )?trial|end your (free )?trial|keep (your|my)|^keep\b|previous|^back$|go back|close dialog|^close$|^user$/i;

  // ── GENERIC QUESTION/SURVEY step ──
  // Any page that asks something and offers selectable options + a continue/submit button
  // (e.g. "Why are you cancelling?"). Rule: pick ONE neutral/positive option, then Continue —
  // never deviate to keep/back/close. Detected from real option elements OR question wording.
  const optionEls = observation.elements.filter(e => e.isOption && e.label && !JUNK_KEYWORDS.test(e.label));
  const hasContinue = observation.elements.some(e => CONTINUE.test(e.label) && !e.isOption);
  const askWords = /sorry to see you go|which one of these|describe your experience|why are you (cancel|leav)|reason (for|to)|tell us|select (a|an|one|your)|step \d+ of \d+|how (was|would)/.test(fullBlob);
  const onQuestion = (optionEls.length >= 2 && hasContinue) || (askWords && optionEls.length >= 1);

  // Neutral/positive-first ranking of question options (avoid complaint reasons that trigger
  // retention offers); the Continue button ranks below options so an option is chosen first.
  const NEGATIVE = /too expensive|technical issue|too many|complicated|didn'?t work|not work/i;
  const qRank = (e) => {
    if (e.isOption) return PREFERRED_CANCEL_REASON.test(e.label) ? 5 : (NEGATIVE.test(e.label) ? 2 : 4);
    if (CONTINUE.test(e.label)) return 1;
    return 0;
  };

  let candidates, rankFn;
  if (onQuestion) {
    const optionPicked = stepsTaken.some(s => s.questionOption);
    candidates = observation.elements.filter(e =>
      !JUNK_KEYWORDS.test(e.label) && !BACKWARD.test(e.label) &&
      (optionPicked ? (CONTINUE.test(e.label) && !e.isOption) : (e.isOption || (CONTINUE.test(e.label) && !e.isOption)))
    );
    rankFn = qRank;
  } else {
    const inCancelFlow = stepsTaken.some(s => /cancel your (free )?trial|end your (free )?trial/i.test(s.label || ""));
    if (inCancelFlow) {
      // Deep in the cancellation flow (a multi-step confirm dialog): advance ONLY via flow
      // buttons — Continue / Confirm / Proceed / final Cancel|End. Ignore the background plans
      // page entirely (apps, account menu, "view more", billing, help) so we don't deviate.
      const FLOW = /\b(continue|proceed|confirm|next|done|finish|complete)\b|cancel (your )?(free )?(trial|membership|subscription|plan)|end (your )?(free )?(trial|membership)|confirm cancell/i;
      candidates = observation.elements.filter(e =>
        FLOW.test(e.label) && !JUNK_KEYWORDS.test(e.label) &&
        !/keep (your|my)|^keep\b|previous|^back$|go back|^close$|close dialog|manage plan|manage account|view \d+ more|included in your plan/i.test(`${e.label} ${e.nearbyHeading}`)
      );
    } else {
      // Not yet in the flow: the broader cancellation-relevant shortlist (Manage plan / Cancel
      // trial must remain available here; only exclude obvious keep/back/close/profile actions).
      candidates = observation.elements.filter(e =>
        (CANCEL_KEYWORDS.test(`${e.label} ${e.nearbyHeading}`) || PREFERRED_CANCEL_REASON.test(e.label)) &&
        !JUNK_KEYWORDS.test(e.label) &&
        !/keep (your|my)|^keep\b|previous|^back$|go back|^close$|close dialog/i.test(e.label)
      );
    }
    rankFn = cancelRelevance;
  }
  // Drop items already tried with no effect. If that empties the list, return NO candidates
  // (→ never-stop recovery waits) rather than re-picking a known-dead element.
  candidates = candidates.filter(e => !avoid.has(e.label));
  // Never click a DISABLED control (e.g. a "Continue" that's greyed out until a reason is
  // selected). Excluding it makes the agent pick the enabling action first, or wait for it
  // to become enabled — instead of clicking a dead button forever.
  candidates = candidates.filter(e => !e.disabled);
  candidates = candidates
    .map((e, i) => ({ e, i, r: rankFn(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, 10)
    .map(x => x.e);

  const menu = candidates.map((e, n) => {
    const tag = e.isProfile ? "[ACCOUNT] " : "";
    const ctx = e.nearbyHeading ? ` (under "${e.nearbyHeading}")` : "";
    const dis = e.disabled ? " [disabled]" : "";
    return `${n + 1}. ${tag}${e.label || e.tag}${ctx}${dis}`;
  }).join("\n") || "  (none detected)";

  // Screen-reader reading of the page (role + accessible name + state, in reading order).
  const screenReader = (observation.a11y || "").slice(0, 2000) || "(no accessible content read)";

  const rules = onQuestion
    ? `This page is asking you a QUESTION before continuing. RULES: pick exactly ONE neutral or positive option (e.g. "no longer need it", "finished my project", "not using it" — NEVER a complaint), then choose Continue. Do not click "Keep", "Back", "Close", or the account menu. Do not deviate from cancelling.`
    : `RULES: Your goal is to fully cancel the trial. Choose the single action that best advances cancellation given what you've already done. Prefer Manage plan → Cancel/End trial → confirm. Never click Keep/Back/Close, the profile/account menu, billing, or help links.`;

  const prompt = `GOAL (highest priority): cancel the "${trial.productName}" free trial completely.

Actions you have already completed (most recent last):
${stepsSummary}

${rules}

Screen-reader view of the current page (role "name" [state], reading order):
${screenReader}

Numbered list of the clickable items you may choose from:
${menu}

Pick the single best NEXT action toward the goal, given what is already done.
Reply with ONLY the number.`;

  return { prompt, candidates, onQuestion };
}

function actionForElement(el, trial) {
  // Only free-text inputs get filled; radio/checkbox/etc. are clicked (selected).
  const t = (el.type || "").toLowerCase();
  const fillable = (el.tag === "textarea") || (el.tag === "input" && /^(|text|email|search|tel|url)$/.test(t));
  const base = fillable
    ? { action: "fill", selector: el.selector, value: trial.userEmail || "", description: `Fill "${el.label}"`, label: el.label, frameId: el.frameId || 0 }
    : { action: "click", selector: el.selector, description: `Click "${el.label || el.tag}"`, label: el.label, frameId: el.frameId || 0 };
  if (el.isOption) base.questionOption = true; // remember we answered a question option
  return base;
}

// Decide the next action. The on-device model is unreliable at selecting the
// account/cancel path (it favours marketing links), so for clearly cancellation-
// relevant elements (account/subscription/cancel, relevance ≥ 3) we pick the
// top-ranked one deterministically. The model is only consulted to disambiguate
// lower-relevance pages. "done" is NOT a model option — it's detected from page text.
async function callAionDecision(tabId, trial, observation, stepsTaken, avoid = new Set(), signal = null) {
  const { prompt, candidates, onQuestion } = buildMenuPrompt(trial, observation, stepsTaken, avoid);

  // Debug payload so the prompt + fetched page content + AI output can be inspected.
  const dbg = {
    url: observation.url,
    onQuestion,
    screenReader: (observation.a11y || "").slice(0, 1500),
    pageText: (observation.text || "").slice(0, 800),
    options: candidates.map((c, n) => `${n + 1}. ${c.label}`),
    prompt
  };

  if (candidates.length === 0) {
    return { action: { action: "need_user", description: "No actionable elements found" }, trace: ["no candidates"], debug: dbg };
  }

  const top = candidates[0];
  const topRel = cancelRelevance(top);
  const optionList = candidates.map((c, n) => `${n + 1}.${c.label}`).join(" | ");

  // Deterministic for clear nav/cancel buttons (rel ≥ 3) — but NOT on a question/survey step,
  // where the AI should choose a neutral/positive option via natural-language understanding.
  if (topRel >= 3 && !onQuestion) {
    dbg.decision = `deterministic(rel=${topRel}) → ${top.label}`;
    return {
      action: actionForElement(top, trial),
      trace: [`deterministic(rel=${topRel}) → ${top.label} ${top.selector}`, `options: ${optionList}`],
      debug: dbg
    };
  }

  // Otherwise ask the model to choose a number among the candidates.
  const scriptPromise = chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (promptText) => {
      try {
        if (typeof LanguageModel === "undefined") return { error: "LanguageModel API not available." };
        const session = await LanguageModel.create();
        let raw;
        try { raw = await session.prompt(promptText); } finally { session.destroy?.(); }
        const rawStr = String(raw || "");
        const num = parseInt(rawStr.match(/\d+/)?.[0], 10);
        return { num, raw: rawStr.slice(0, 160) };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [prompt]
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Aion timed out after 5 minutes")), 300000)
  );

  // Race against abort so clicking "Stop" returns immediately instead of waiting on Aion.
  const results = await Promise.race([scriptPromise, timeoutPromise, whenAborted(signal).then(() => "ABORTED")]);
  if (results === "ABORTED" || signal?.aborted) {
    return { action: { action: "aborted", description: "Stopped by user" }, trace: ["aborted"], debug: dbg };
  }
  const result = results?.[0]?.result;
  if (result?.error) throw new Error(result.error);

  let { num, raw } = result || {};
  dbg.rawOutput = raw;
  // Fall back to the best-ranked candidate if the model's number is unusable.
  if (!Number.isInteger(num) || num < 1 || num > candidates.length) num = 1;
  const el = candidates[num - 1];
  dbg.decision = `model:${num} → ${el.label}`;

  return {
    action: actionForElement(el, trial),
    trace: [`model:${num} → ${el.action || "click"} ${el.selector} (${el.label}) — raw="${raw}"`, `options: ${optionList}`],
    debug: dbg
  };
}

// Is this a mid-flow "reason for cancelling" survey / question step? (NOT a confirmation.)
// The survey lists reason options like "My free trial ended." which must never be mistaken
// for a success confirmation.
function isCancelSurvey(observation) {
  const t = `${observation.a11y || ""} ${observation.text || ""}`.toLowerCase();
  const hasOptions = (observation.elements || []).some(e => e.isOption);
  const surveyText = /sorry to see you go|which one of these|describe your experience|reason (for|to) (cancel|leav)|why are you (cancel|leav)|step \d+ of \d+/.test(t);
  return hasOptions || surveyText;
}

// Fast, broadened text match for a "cancellation done" confirmation (covers most phrasings).
// NOTE: requires explicit "cancelled/canceled" wording — bare "ended" is NOT enough, because
// the survey option "My free trial ended." would otherwise false-match.
function looksCancelled(observation) {
  const t = `${observation.a11y || ""} ${observation.text || ""}`.toLowerCase();
  return /(subscription|membership|plan|free ?trial|trial)[^.]{0,60}(has been |have been |is |was |now |successfully )?(cancell?ed|terminated)/.test(t)
      || /(cancell?ed|terminated)[^.]{0,60}(subscription|membership|plan|free ?trial|trial)/.test(t)
      || /cancell?ation (is |was |has been )?(complete|completed|confirmed|successful|done|processed|in progress)/.test(t)
      || /your (free )?(plan|membership|subscription|trial) (has been |is now |is |was )?(cancell?ed|terminated)/.test(t)
      || /(free )?trial (has been |is )?cancell?ed/.test(t)
      || /(you|we)('| ha)ve (successfully )?cancell?ed/.test(t)
      || /successfully cancell?ed/.test(t)
      || /cancell?ation (request )?(has been )?(received|submitted|confirmed|complete)/.test(t)
      || /auto[- ]?renew(al)? (is |has been |was )?(turned off|off|disabled)/.test(t)
      || (/cancell?/.test(t) && /(you (will|won'?t)|you'?ll)[^.]{0,30}(no longer|not) be (charged|billed)/.test(t));
}

// Decide whether the current page confirms a SUCCESSFUL cancellation. Tries the fast text
// match first, then — for paraphrases the regex misses — asks Aion to judge semantically
// (gated so the model is only consulted on plausible confirmation pages, never the survey).
async function confirmCancelled(tabId, observation, signal = null) {
  // A "reason for cancelling" survey / any page still showing selectable options is NOT a
  // confirmation — it's mid-flow. Never mark done here (survey reasons like "My free trial
  // ended." would otherwise false-match).
  if (isCancelSurvey(observation)) return false;
  if (looksCancelled(observation)) return true;
  const t = `${observation.a11y || ""} ${observation.text || ""}`.toLowerCase();
  // Cheap gate: mentions cancel + a completion-ish cue (no survey — already excluded above).
  const maybeDone = /cancel/.test(t)
    && /(success|complete|confirm|done|no longer|won'?t be charged|will not be charged|thank you|all set|we'?ll miss you)/.test(t);
  if (!maybeDone) return false;
  try {
    const snippet = (observation.text || observation.a11y || "").slice(0, 1500);
    const r = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async (text) => {
          if (typeof LanguageModel === "undefined") return "no";
          const s = await LanguageModel.create();
          let raw; try { raw = await s.prompt(`Page text:\n${text}\n\nDoes this page CONFIRM that the subscription or free trial has now been CANCELLED (the cancellation is complete/successful)? Answer with only "yes" or "no".`); } finally { s.destroy?.(); }
          return String(raw || "").toLowerCase();
        },
        args: [snippet]
      }),
      whenAborted(signal).then(() => "ABORTED")
    ]);
    if (r === "ABORTED") return false;
    const ans = r?.[0]?.result || "";
    return /\byes\b/.test(ans) && !/\bno\b/.test(ans.replace(/\byes\b/, ""));
  } catch { return false; }
}

// ─── Cancellation — browser actions ──────────────────────────────────────────

// Resolves as soon as the abort signal fires — used to make long waits interruptible
// so clicking "Stop" takes effect immediately instead of after the current await.
function whenAborted(signal) {
  return new Promise((resolve) => {
    if (!signal) return;           // never resolves if no signal (so it just won't win the race)
    if (signal.aborted) return resolve("aborted");
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}
// Sleep that returns early if aborted.
function sleepOrAbort(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function waitForTabLoad(tabId, timeoutMs = 12000, signal = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch { return; }
    await sleepOrAbort(400, signal);
  }
}

// Wait until the page's DOM stops changing (quiet for `quietMs`), capped at `maxMs`.
// Smarter than a fixed delay: fast on ready pages, patient on slow SPAs (account.adobe.com).
// Pattern adapted from browser-use / nanobrowser DOM-stability waits.
async function waitForStable(tabId, signal = null, { minMs = 1500, quietMs = 1200, maxMs = 14000 } = {}) {
  await sleepOrAbort(minMs, signal); // always give the SPA a moment to start rendering
  if (signal?.aborted) return;
  try {
    // Run in EVERY frame; executeScript resolves only when all frames have settled — so we
    // wait for the survey iframe too. "Settled" = DOM quiet for quietMs AND no aria-busy
    // region loading (NVDA treats aria-busy="true" as "content not ready").
    // Raced against abort so clicking Stop returns immediately.
    await Promise.race([whenAborted(signal), chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, world: "MAIN",
      func: (quietMs, maxMs) => new Promise((resolve) => {
        let quietTimer, done = false;
        const start = Date.now();
        const anyBusy = () => { try { return !!document.querySelector('[aria-busy="true"]'); } catch { return false; } };
        const finish = () => { if (done) return; done = true; try { obs.disconnect(); } catch {} clearTimeout(quietTimer); clearTimeout(hard); resolve(true); };
        const settle = () => {
          // If something is still flagged busy and we have time budget left, keep waiting.
          if (anyBusy() && Date.now() - start < maxMs - quietMs) { bump(); return; }
          finish();
        };
        const bump = () => { clearTimeout(quietTimer); quietTimer = setTimeout(settle, quietMs); };
        const obs = new MutationObserver(bump);
        try { obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); } catch { resolve(true); return; }
        const hard = setTimeout(finish, maxMs);
        bump();
      }),
      args: [quietMs, maxMs]
    })]);
  } catch {}
}

const BrowserActions = {
  async navigate(tabId, url) {
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("Invalid URL");
    await chrome.tabs.update(tabId, { url });
    await waitForTabLoad(tabId);
  },

  async click(tabId, selector, label = "", frameId = 0) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: "MAIN",
      func: (sel, lbl) => {
        // Deep query across light DOM + open shadow roots.
        function deepQueryAll(selector) {
          const out = []; const seen = new Set();
          (function walk(root){
            let m=[]; try{ m=root.querySelectorAll(selector); }catch{}
            for (const el of m){ if(!seen.has(el)){ seen.add(el); out.push(el); } }
            let all=[]; try{ all=root.querySelectorAll("*"); }catch{}
            for (const el of all){ if(el.shadowRoot) walk(el.shadowRoot); }
          })(document);
          return out;
        }
        const deepQuery = (selector) => deepQueryAll(selector)[0] || null;
        try {
          // Normalise unquoted numeric attribute: [data-tg-i=5] → [data-tg-i="5"]
          if (sel) sel = sel.replace(/\[data-tg-i=(\d+)\]/g, '[data-tg-i="$1"]');
          let el = sel ? deepQuery(sel) : null;
          // Fallback 1: match by visible label text
          if (!el && lbl) {
            const needle = lbl.toLowerCase().trim();
            for (const c of deepQueryAll('button,a,[role="button"],[role="link"]')) {
              const text = (c.innerText || c.getAttribute("aria-label") || c.getAttribute("title") || "").toLowerCase().trim();
              if (text && (text === needle || text.includes(needle) || needle.includes(text))) { el = c; break; }
            }
          }
          // Fallback 2: account button — match by aria-label, title, img alt, or class
          if (!el && /account|manage.{0,4}account|my.{0,4}account/i.test(lbl || "")) {
            for (const c of deepQueryAll('button,a,[role="button"]')) {
              const aria  = (c.getAttribute("aria-label") || "").toLowerCase();
              const title = (c.getAttribute("title") || "").toLowerCase();
              const cls   = (typeof c.className === "string" ? c.className : "").toLowerCase();
              const img   = (c.querySelector("img")?.getAttribute("alt") || "").toLowerCase();
              if (/\baccount\b|manage.{0,4}account|my.{0,4}account/.test(aria + " " + title + " " + cls + " " + img)) { el = c; break; }
            }
          }
          // Clean up index attributes regardless of success
          deepQueryAll("[data-tg-i]").forEach(e => e.removeAttribute("data-tg-i"));
          if (!el) return { error: `Element not found: ${sel || lbl}` };
          // Force same-tab navigation — links that open a new tab (target=_blank) would
          // leave the agent stuck on the original tab.
          const anchor = el.closest?.("a") || (el.tagName === "A" ? el : null);
          if (anchor && anchor.target && anchor.target !== "_self") anchor.target = "_self";
          if (el.target && el.target !== "_self") el.target = "_self";
          el.scrollIntoView({ block: "center" });
          el.click();
          // If this is a <label> (or wraps) a checkbox/radio, make sure the control
          // actually toggles (Spectrum/React survey options) so e.g. "Continue" enables.
          const ctrl = el.matches?.("input") ? el
                     : (el.querySelector?.('input[type="checkbox"],input[type="radio"]') ||
                        (el.control && /checkbox|radio/.test(el.control.type) ? el.control : null));
          if (ctrl && !ctrl.checked) { try { ctrl.click(); } catch {} }
          return { ok: true };
        } catch (e) { return { error: e.message }; }
      },
      args: [selector, label]
    });
    const r = results?.[0]?.result;
    if (r?.error) throw new Error(r.error);
  },

  async fill(tabId, selector, value, label = "", frameId = 0) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: "MAIN",
      func: (sel, val, lbl) => {
        function deepQueryAll(selector) {
          const out = []; const seen = new Set();
          (function walk(root){
            let m=[]; try{ m=root.querySelectorAll(selector); }catch{}
            for (const el of m){ if(!seen.has(el)){ seen.add(el); out.push(el); } }
            let all=[]; try{ all=root.querySelectorAll("*"); }catch{}
            for (const el of all){ if(el.shadowRoot) walk(el.shadowRoot); }
          })(document);
          return out;
        }
        try {
          if (sel) sel = sel.replace(/\[data-tg-i=(\d+)\]/g, '[data-tg-i="$1"]');
          let el = sel ? (deepQueryAll(sel)[0] || null) : null;
          if (!el && lbl) {
            const needle = lbl.toLowerCase();
            for (const c of deepQueryAll("input,textarea")) {
              if ([c.placeholder, c.getAttribute("aria-label"), c.name].join(" ").toLowerCase().includes(needle)) {
                el = c; break;
              }
            }
          }
          if (!el) return { error: `Element not found: ${sel || lbl}` };
          const haystack = (el.type + " " + el.name + " " + el.placeholder).toLowerCase();
          if (/password|otp|card|cc|cvv/.test(haystack)) return { error: "Sensitive field — blocked" };
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
          setter ? setter.call(el, val) : (el.value = val);
          el.dispatchEvent(new Event("input",  { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        } catch (e) { return { error: e.message }; }
      },
      args: [selector, value, label]
    });
    const r = results?.[0]?.result;
    if (r?.error) throw new Error(r.error);
  },

  async scroll(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      func: () => window.scrollBy(0, window.innerHeight * 0.7)
    });
  },

  async wait(ms = 1500) {
    await new Promise(r => setTimeout(r, ms));
  }
};

async function executeAgentAction(step, tabId) {
  switch (step.action) {
    case "navigate": return BrowserActions.navigate(tabId, step.url || step.value);
    case "click":    return BrowserActions.click(tabId, step.selector || "", step.description || "", step.frameId || 0);
    case "fill":     return BrowserActions.fill(tabId, step.selector || "", step.value || "", step.description || "", step.frameId || 0);
    case "scroll":   return BrowserActions.scroll(tabId);
    case "wait":     return BrowserActions.wait();
    default: throw new Error(`Unsupported action: ${step.action}`);
  }
}

// ─── Cancellation — agent loop ────────────────────────────────────────────────

async function runCancellationAgent(trial, tabId) {
  const { backendUrl } = await getSettings();
  const trialId = trial.id;
  const ac = new AbortController();
  _abortControllers.set(trialId, ac);
  const stepsTaken = [];
  const noEffectLabels = new Set();  // labels of actions that produced no page change
  const stickyAvoid = new Set();     // one-shot milestones never to re-click (e.g. "Manage plan")
  const pickCounts = {};             // how many times each label has been chosen
  const seenSigs = new Set();        // page-state signatures visited (to tell progress from toggling)
  _traceBuf = [];  // fresh debug trace for this run

  // Fire-and-forget — never blocks the agent loop
  const patch = (fields) => { patchTrialRemote(trialId, trial.userEmail, fields, backendUrl).catch(() => {}); };

  try {
    await patch({ cancellationStatus: "running", cancellationStartedAt: new Date().toISOString() });
    await updateLocalTrial(trialId, { cancellationStatus: "running" });
    notifySP("phase", { phase: "running", trialId });

    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    } catch {}

    // Optional deep-link straight to the subscription/cancellation page.
    if (trial.startUrl) {
      spToast("info", `Opening subscription page: ${trial.startUrl}`, trialId);
      try { await BrowserActions.navigate(tabId, trial.startUrl); await waitForStable(tabId, ac.signal); } catch {}
    }

    // Signature of the clickable surface — robust to dynamic body-text flicker.
    const sig = (obs) => [...new Set((obs.elements || []).map(e => e.label))].sort().join("|");
    // The action awaiting effect evaluation (done at the top of the NEXT iteration, after
    // the page has fully loaded — so we never judge a half-loaded page).
    let pending = null; // { step, priorUrl, priorSig }
    let restrictedTries = 0; // consecutive iterations the tab was on a non-scriptable page

    // No step cap — loop runs until done / error / user Stop (per user request).
    for (let i = 0; ; i++) {
      if (ac.signal.aborted) {
        await patch({ cancellationStatus: "stopped" });
        await updateLocalTrial(trialId, { cancellationStatus: "stopped" });
        spToast("stopped", "Cancellation stopped.", trialId);
        notifySP("phase", { phase: "stopped", trialId });
        return;
      }

      // Guard: the working tab must exist AND be scriptable before we observe/act.
      const scriptable = await tabScriptability(tabId);
      if (scriptable.gone) {
        // Terminal: the working tab was closed — can't cancel on a dead tab, so stop.
        spToast("error", "The browser tab was closed — cancellation halted.", trialId);
        await patch({ cancellationStatus: "failed", cancellationError: "Tab closed" });
        await updateLocalTrial(trialId, { cancellationStatus: "failed" });
        notifySP("phase", { phase: "failed", trialId });
        return;
      }
      if (scriptable.restricted) {
        // The tab navigated to a page we can't script (chrome://, edge://, settings, …).
        // Try to go back a few times; if it stays restricted, halt instead of spinning.
        if (++restrictedTries > 3) {
          spToast("error", "The tab is on a page that can't be controlled (e.g. a browser/settings page) — cancellation halted.", trialId);
          await patch({ cancellationStatus: "failed", cancellationError: "Restricted page" });
          await updateLocalTrial(trialId, { cancellationStatus: "failed" });
          notifySP("phase", { phase: "failed", trialId });
          return;
        }
        spToast("info", "Page can't be controlled — trying to go back…", trialId);
        try { await chrome.tabs.goBack(tabId); } catch {}
        await sleepOrAbort(2000, ac.signal);
        continue;
      }
      restrictedTries = 0;

      // Wait for the page to FULLY render before Aion reads it (right before the fetch),
      // using DOM-stability detection so we never analyse / act on half-rendered content.
      if (pending) {
        spToast("info", "Waiting for the page to finish loading…", trialId);
        await waitForStable(tabId, ac.signal);
        if (ac.signal.aborted) continue;
      }

      let observation = await observePage(tabId);
      // Never give up on an empty page — wait and re-observe indefinitely (occasionally
      // scrolling to trigger lazy rendering, and recovering from browser error pages)
      // until elements appear or the user stops.
      let waitTries = 0;
      while (observation.elements.length === 0 && !ac.signal.aborted) {
        // Tab closed or went to a restricted page mid-wait — stop spinning and let the
        // top-of-loop guard halt (gone) or recover (restricted) on the next iteration.
        if (observation.tabGone || observation.restricted) break;
        waitTries++;
        if (observation.errorPage) {
          // The tab landed on a browser error page — recover by going back, then reload.
          spToast("error", "Hit an error page — recovering…", trialId);
          try { await chrome.tabs.goBack(tabId); } catch {}
          await new Promise(res => setTimeout(res, 2500));
          try { const t = await chrome.tabs.get(tabId); if (t.url && /chrome-error|edge:\/\/|^about:/.test(t.url)) await chrome.tabs.reload(tabId); } catch {}
        } else {
          spToast("info", `Page still loading — waiting (${waitTries})…`, trialId);
          if (waitTries % 3 === 0) { try { await BrowserActions.scroll(tabId); } catch {} }
        }
        await sleepOrAbort(3000, ac.signal);
        if (ac.signal.aborted) break;
        observation = await observePage(tabId);
      }
      if (ac.signal.aborted) continue;
      // Tab died / went restricted while waiting — re-run the loop so the top guard handles it.
      if (observation.tabGone || observation.restricted) continue;

      const curSig = sig(observation);
      // Now that the page is loaded, evaluate the PREVIOUS action's effect.
      if (pending) {
        const st = pending.step;
        const urlChanged  = observation.url !== pending.priorUrl;
        const pageChanged = urlChanged || curSig !== pending.priorSig;
        // FORWARD PROGRESS = we landed on a page-state we've never seen before (new content).
        // A TOGGLE/loop lands back on a previously-seen state. The cancel flow is all on ONE
        // URL (modal/iframe), so we use the state signature — not the URL — to tell them apart.
        const newState = !seenSigs.has(curSig);
        // One-shot milestones must never be re-clicked (prevents bouncing backward).
        if (pageChanged && st.label && /manage plan|manage subscription|cancel your (free )?trial|end your (free )?trial/i.test(st.label)) {
          stickyAvoid.add(st.label);
        }
        if (urlChanged || (pageChanged && newState)) {
          // Forward progress → fresh start so a legitimately repeated label (sequential
          // "Continue" buttons through the multi-step confirm dialog) isn't blocked.
          noEffectLabels.clear();
          Object.keys(pickCounts).forEach(k => delete pickCounts[k]);
        } else if (!pageChanged && st.selector) {
          // Same surface → did nothing useful.
          if (st.label) noEffectLabels.add(st.label);
          spToast("info", `No effect from "${st.label || st.selector}" — avoiding it next`, trialId);
        }
        // else: page changed but to a state we've seen before = toggle/loop → keep pickCounts
        // so the repeat-breaker catches it.
        stepsTaken.push({ ...st, url: pending.priorUrl, result: { urlAfter: observation.url, urlChanged, pageChanged } });
        notifySP("step_done", { step: { ...st, index: i }, trialId });
        pending = null;
      }
      seenSigs.add(curSig);  // remember this state so a later return to it counts as a toggle

      console.log(`[TG-DEBUG] step ${i} — observed ${observation.elements.length} elements at ${observation.url}`);
      spToast("info", `Found ${observation.elements.length} elements on page`, trialId);

      // Detect a completed cancellation from the page itself (after at least one action).
      if (i > 0 && await confirmCancelled(tabId, observation, ac.signal)) {
        spToast("done", `${trial.productName} trial cancelled — confirmation detected on page.`, trialId);
        await patch({ cancellationStatus: "completed", cancellationCompletedAt: new Date().toISOString() });
        await updateLocalTrial(trialId, { cancellationStatus: "completed" });
        notifySP("phase", { phase: "completed", trialId });
        return;
      }

      // Password gate: if the page asks for a password to proceed, PAUSE and let the user
      // type it manually (we never auto-fill passwords), then resume once it's entered.
      const pw = await detectPasswordPrompt(tabId, observation);
      if (pw.present && !pw.filled) {
        spToast("password", "🔒 A password is required to continue. Please type your password into the page — I'll resume automatically once it's entered.", trialId);
        notifySP("phase", { phase: "awaiting_password", trialId });
        await patch({ cancellationStatus: "needs_user", cancellationError: "Awaiting password entry" });
        let waited = 0;
        while (!ac.signal.aborted) {
          await sleepOrAbort(3000, ac.signal);
          if (ac.signal.aborted) break;
          const s = await detectPasswordPrompt(tabId, await observePage(tabId));
          if (!s.present || s.filled) break;           // user typed it, or page moved on
          if (++waited % 10 === 0) spToast("password", "Still waiting for you to enter the password…", trialId);
        }
        if (ac.signal.aborted) {
          await patch({ cancellationStatus: "stopped" });
          await updateLocalTrial(trialId, { cancellationStatus: "stopped" });
          spToast("stopped", "Cancellation stopped.", trialId);
          notifySP("phase", { phase: "stopped", trialId });
          return;
        }
        spToast("info", "Password entered — continuing the cancellation.", trialId);
        await patch({ cancellationStatus: "running" });
        notifySP("phase", { phase: "running", trialId });
        await waitForStable(tabId, ac.signal);
        pending = null;   // re-observe cleanly on the next iteration
        continue;
      }

      let step;
      try {
        spToast("planning", "Aion is analysing the page…", trialId);
        const decision = await callAionDecision(tabId, trial, observation, stepsTaken, new Set([...noEffectLabels, ...stickyAvoid]), ac.signal);
        step = decision.action;
        console.log(`[TG-DEBUG] step ${i} — decision`, { trace: decision.trace, step, debug: decision.debug });
        notifySP("debug", { step: i, trace: decision.trace, action: step, ...decision.debug });

        // DEBUG: print the exact prompt sent to Aion (+ its raw reply) in the side panel.
        if (decision.debug?.prompt) spToast("prompt", `🧠 PROMPT → Aion (step ${i}):\n${decision.debug.prompt}`, trialId);
        if (decision.debug?.rawOutput) spToast("prompt", `💬 Aion replied: ${decision.debug.rawOutput}`, trialId);

        // Reasoning trace — show what Aion picked from the menu
        if (!["done", "need_user", "fail"].includes(step.action)) {
          spToast("select", `Aion chose: ${step.description || step.action}`, trialId);
          // Repeat-breaker: if the same element keeps getting chosen (e.g. a panel that
          // just toggles), force-avoid it after 2 picks so the agent moves on.
          if (step.label) {
            pickCounts[step.label] = (pickCounts[step.label] || 0) + 1;
            if (pickCounts[step.label] >= 2) {
              noEffectLabels.add(step.label);
              spToast("info", `"${step.label}" chosen ${pickCounts[step.label]}× — avoiding it from now`, trialId);
            }
          }
        }
      } catch (err) {
        // Never stop on a transient decision error — wait and retry (user directive).
        spToast("error", `Decision error: ${err.message} — retrying…`, trialId);
        await sleepOrAbort(4000, ac.signal);
        continue;
      }

      // User hit Stop while Aion was deciding — halt immediately.
      if (step.action === "aborted" || ac.signal.aborted) {
        await patch({ cancellationStatus: "stopped" });
        await updateLocalTrial(trialId, { cancellationStatus: "stopped" });
        spToast("stopped", "Cancellation stopped.", trialId);
        notifySP("phase", { phase: "stopped", trialId });
        return;
      }

      if (step.action === "done") {
        spToast("done", `${trial.productName} trial cancelled successfully!`, trialId);
        await patch({ cancellationStatus: "completed", cancellationCompletedAt: new Date().toISOString() });
        await updateLocalTrial(trialId, { cancellationStatus: "completed" });
        notifySP("phase", { phase: "completed", trialId });
        return;
      }

      if (["need_user", "fail"].includes(step.action)) {
        // No actionable element right now — DON'T stop. Wait, scroll, reset avoidance,
        // and keep trying until something cancellable appears (user directive).
        spToast("info", "No actionable element yet — waiting & retrying…", trialId);
        await patch({ cancellationStatus: "running" });
        try { await BrowserActions.scroll(tabId); } catch {}
        await sleepOrAbort(4000, ac.signal);
        // Periodically clear avoidance so options re-open in case the page changed.
        if (i % 4 === 0) noEffectLabels.clear();
        continue;
      }

      spToast("step", step.description || `${step.action}…`, trialId);
      notifySP("step_start", { step: { ...step, index: i + 1 }, trialId });

      try {
        await executeAgentAction(step, tabId);
        await waitForTabLoad(tabId, 12000, ac.signal);
      } catch (err) {
        if (ac.signal.aborted) {
          await patch({ cancellationStatus: "stopped" });
          await updateLocalTrial(trialId, { cancellationStatus: "stopped" });
          spToast("stopped", "Cancellation stopped.", trialId);
          notifySP("phase", { phase: "stopped", trialId });
          return;
        }
        // Never stop on a step failure — avoid that element, wait, and keep going.
        spToast("error", `Step ${i + 1} failed: ${err.message} — avoiding & retrying…`, trialId);
        notifySP("step_error", { step, error: err.message, trialId });
        if (step.label) noEffectLabels.add(step.label);
        await sleepOrAbort(3000, ac.signal);
        continue;
      }

      // Defer effect evaluation to the top of the next iteration (after the 10s load wait),
      // so we judge the result only once the page has fully rendered.
      pending = { step, priorUrl: observation.url, priorSig: sig(observation) };
    }
  } finally {
    _abortControllers.delete(trialId);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[TrialGuard BG] message received:", message.action);

  if (message.action === "trialDetected") {
    const handle = async () => {
      try {
        const { userEmail, backendUrl } = await getSettings();
        if (sender.tab?.id) {
          chrome.action.setBadgeText({ text: "✓", tabId: sender.tab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId: sender.tab.id });
        }
        if (!userEmail) {
          chrome.action.setBadgeText({ text: "!" });
          chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
          sendResponse({ saved: true, backend: false });
          return;
        }
        try {
          await saveTrial(message.data, userEmail, backendUrl);
          console.log("[TrialGuard BG] Saved to backend");
          sendResponse({ saved: true, backend: true });
        } catch (err) {
          console.error("[TrialGuard BG] Backend save failed:", err.message);
          sendResponse({ saved: true, backend: false, error: err.message });
        }
      } catch (err) {
        console.error("[TrialGuard BG] Handler error:", err.message);
        sendResponse({ saved: false, error: err.message });
      }
    };
    handle();
    return true;
  }

  if (message.action === "tgReload") {
    // DEBUG: let a content-script trigger an extension reload (picks up new code from disk)
    sendResponse({ reloading: true });
    setTimeout(() => chrome.runtime.reload(), 50);
    return true;
  }

  if (message.action === "requestCancellation") {
    const { trial: rawTrial } = message;
    // tabId from the message (popup flow) or fall back to the sender tab (content-script trigger)
    const tabId = message.tabId ?? sender.tab?.id;
    if (_abortControllers.has(rawTrial?.id)) {
      sendResponse({ started: false, reason: "already running" });
      return true;
    }
    const start = async () => {
      const { userEmail } = await getSettings();
      const trial = { ...rawTrial, userEmail: rawTrial.userEmail || userEmail || null };
      runCancellationAgent(trial, tabId).catch(err => {
        console.error("[TrialGuard BG] Agent error:", err.message);
        notifySP("phase", { phase: "failed", trialId: trial?.id, error: err.message });
      });
    };
    start();
    sendResponse({ started: true });
    return true;
  }

  if (message.action === "cancelStop") {
    const { trialId } = message;
    const ac = _abortControllers.get(trialId);
    if (ac) ac.abort();
    sendResponse({ stopped: !!ac });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
