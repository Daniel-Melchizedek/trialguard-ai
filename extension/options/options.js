const emailInput = document.getElementById("email");
const backendInput = document.getElementById("backendUrl");
const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["userEmail", "backendUrl"], data => {
  emailInput.value = data.userEmail || "";
  backendInput.value = data.backendUrl || CONFIG.BACKEND_URL;
});

saveBtn.addEventListener("click", () => {
  const email = emailInput.value.trim();
  const backendUrl = backendInput.value.trim().replace(/\/$/, "");

  if (!email || !email.includes("@")) {
    statusEl.style.color = "#f87171";
    statusEl.textContent = "Please enter a valid email address.";
    return;
  }

  chrome.storage.sync.set({ userEmail: email, backendUrl }, () => {
    statusEl.style.color = "#34d399";
    statusEl.textContent = "✓ Settings saved.";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  });
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all detected trials? This cannot be undone.")) return;
  chrome.storage.sync.remove(["trials"], () => {
    statusEl.style.color = "#fbbf24";
    statusEl.textContent = "Trial history cleared.";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  });
});
