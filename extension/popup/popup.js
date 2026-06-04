function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown end date";
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  });
}

function renderTrial(trial) {
  const days = daysUntil(trial.trialEndDate);
  const card = document.createElement("div");
  card.className = "trial-card";

  let dateClass = "ok", dateLabel = "";
  if (days === null) {
    dateLabel = "End date unknown";
    dateClass = "ok";
  } else if (days < 0) {
    dateLabel = "Trial expired";
    dateClass = "danger";
    card.classList.add("expired");
  } else if (days <= 3) {
    dateLabel = `⚠️ Ends in ${days} day${days !== 1 ? "s" : ""} — cancel now!`;
    dateClass = "warn";
    card.classList.add("expiring-soon");
  } else {
    dateLabel = `Ends in ${days} days (${formatDate(trial.trialEndDate)})`;
    dateClass = "ok";
  }

  card.innerHTML = `
    <div class="trial-name">${trial.productName || "Unknown Product"}</div>
    <div class="trial-meta">${trial.websiteUrl || ""}</div>
    <div class="trial-date ${dateClass}">${dateLabel}</div>
  `;
  return card;
}

chrome.storage.sync.get(["userEmail", "trials"], data => {
  const email = data.userEmail;
  const trials = data.trials || [];

  const noBanner = document.getElementById("no-email-banner");
  const emailRow = document.getElementById("email-display");
  const emailText = document.getElementById("email-text");
  const trialList = document.getElementById("trial-list");
  const emptyState = document.getElementById("empty-state");

  if (!email) {
    noBanner.classList.remove("hidden");
  } else {
    emailRow.classList.remove("hidden");
    emailText.textContent = email;
  }

  if (trials.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    trials.forEach(t => trialList.appendChild(renderTrial(t)));
  }
});

document.getElementById("open-options")?.addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById("open-options-link")?.addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
