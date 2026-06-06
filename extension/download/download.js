const statusEl = document.getElementById("status");
const btnEl    = document.getElementById("btn");
const pw       = document.getElementById("pw");
const pb       = document.getElementById("pb");

let pollInterval = null;

async function runDiagnostics() {
  const out = [];

  // 1. Browser identity
  const brands = navigator.userAgentData?.brands?.map(b => `${b.brand} ${b.version}`).join(", ") || navigator.userAgent;
  const isMSEdge = brands.includes("Microsoft Edge") || navigator.userAgent.includes("Edg/");
  out.push(`Browser: ${brands}`);
  out.push(`Is Edge: ${isMSEdge}`);

  // 2. LanguageModel API presence
  if (typeof LanguageModel === "undefined") {
    out.push("LanguageModel: NOT FOUND");
    return out;
  }
  out.push(`LanguageModel type: ${typeof LanguageModel}`);
  out.push(`LanguageModel keys: ${Object.getOwnPropertyNames(LanguageModel).join(", ")}`);

  // 3. Availability
  let av;
  try {
    av = await LanguageModel.availability();
  } catch(e) {
    av = "unknown";
  }
  out.push(`availability(): ${av}`);

  // 4. Params / capabilities
  try {
    const params = await LanguageModel.params?.();
    if (params) out.push(`params: ${JSON.stringify(params)}`);
  } catch(e) { out.push(`params() error: ${e.message}`); }

  // 5. If available, ask the model its identity
  if (av === "available") {
    try {
      const session = await LanguageModel.create();
      const identity = await session.prompt("What is your name and version? Reply in one sentence.");
      out.push(`Model self-report: "${identity.trim()}"`);
      session.destroy();
    } catch(e) { out.push(`Identity prompt error: ${e.message}`); }
  }

  return out;
}

async function init() {
  if (typeof LanguageModel === "undefined") {
    statusEl.innerHTML = `<span class="err">LanguageModel API unavailable. Requires Edge 150+ Canary.</span>`;
    btnEl.textContent = "Not supported";
    return;
  }

  // Run diagnostics and display
  statusEl.innerHTML = `<div class="spinner"></div> <span>Running diagnostics…</span>`;
  const diag = await runDiagnostics();
  console.log("[TrialGuard] === DIAGNOSTICS ===");
  diag.forEach(l => console.log("[TrialGuard]", l));

  let av;
  try {
    av = await LanguageModel.availability();
  } catch(e) {
    av = "unknown";
  }

  if (av === "available") { showReady(diag); return; }
  if (av === "unavailable") {
    statusEl.innerHTML = `<span class="err">Aion model unavailable on this device.</span>`;
    btnEl.textContent = "Unavailable";
    return;
  }

  statusEl.innerHTML = `<span>Model status: <b>${av}</b>. Not yet downloaded.</span>`;
  btnEl.textContent = "⬇️ Start Download";
  btnEl.disabled = false;
}

btnEl.addEventListener("click", async () => {
  btnEl.disabled = true;
  btnEl.textContent = "Downloading…";
  pw.style.display = "block";
  statusEl.innerHTML = `<div class="spinner"></div> <span id="st">Calling LanguageModel.create()…</span>`;

  pollInterval = setInterval(async () => {
    let av;
    try { av = await LanguageModel.availability(); } catch(e) { av = "unknown"; }
    const st = document.getElementById("st");
    if (st) st.textContent = `Status: ${av} — waiting…`;
    console.log("[TrialGuard] polled availability:", av);
    if (av === "available") { clearInterval(pollInterval); showReady([]); }
  }, 2000);

  try {
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", e => {
          clearInterval(pollInterval);
          console.log("[TrialGuard] progress:", e.loaded, "/", e.total);
          pb.classList.remove("indeterminate");
          if (e.total > 0) {
            const pct = Math.round((e.loaded / e.total) * 100);
            pb.style.width = pct + "%";
            statusEl.innerHTML = `<div class="spinner"></div> <span>${pct}%  (${(e.loaded/1024/1024).toFixed(0)} / ${(e.total/1024/1024).toFixed(0)} MB)</span>`;
            btnEl.textContent = `${pct}%`;
          } else {
            pb.classList.add("indeterminate");
            statusEl.innerHTML = `<div class="spinner"></div> <span>${(e.loaded/1024/1024).toFixed(0)} MB received…</span>`;
          }
          chrome.storage.local.set({ aionProgress: { loaded: e.loaded, total: e.total, ts: Date.now() } });
        });
      }
    });
    clearInterval(pollInterval);
    session.destroy();
    showReady([]);
  } catch (err) {
    clearInterval(pollInterval);
    console.error("[TrialGuard]", err);
    pw.style.display = "none";
    statusEl.innerHTML = `<span class="err">⚠️ ${err.message}</span>`;
    btnEl.disabled = false;
    btnEl.textContent = "⬇️ Retry";
  }
});

function showReady(diag) {
  clearInterval(pollInterval);
  pw.style.display = "none";

  const selfReport = diag.find(l => l.startsWith("Model self-report:")) || "";
  const modelName  = selfReport ? selfReport.replace("Model self-report: ", "") : "Aion 1.0";

  statusEl.innerHTML = `<span class="ready">✓ Model ready — ${modelName}</span>`;
  btnEl.textContent = "✓ Close";
  btnEl.disabled = false;
  btnEl.onclick = () => window.close();
  chrome.storage.sync.set({ aionReady: true });
  setTimeout(() => window.close(), 5000);
}

init();
