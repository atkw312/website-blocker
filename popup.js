/**
 * popup.js — Sumi popup (v3 freemium).
 *
 * Toggle, duration selector, daily usage counter.
 */

const toggleIntent = document.getElementById("toggle-intent");
const sessionStatus = document.getElementById("session-status");
const usageEl = document.getElementById("usage");
const durButtons = document.querySelectorAll(".dur-btn");

// =========================================================================
// Render
// =========================================================================

async function render() {
  const data = await chrome.storage.local.get([
    "intentModeEnabled",
    "sessionEndTime",
    "sessionPausedRemaining",
    "sessionDurationMinutes",
    "dailySessionCount",
    "lastSessionDate",
    "isProUser"
  ]);

  const enabled = data.intentModeEnabled ?? false;
  const duration = data.sessionDurationMinutes ?? 25;

  toggleIntent.checked = enabled;

  // Duration buttons
  durButtons.forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.min) === duration);
  });

  // Session status
  if (enabled) {
    const remaining = await getRemainingMs();
    if (remaining != null) {
      const totalSeconds = Math.ceil(remaining / 1000);
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      const paused = data.sessionPausedRemaining != null;
      const label = paused ? " (paused)" : "";
      sessionStatus.textContent = `${m}:${String(s).padStart(2, "0")} remaining${label}`;
      sessionStatus.style.background = "#1c1917";
      sessionStatus.style.color = "#f7f4f0";
      sessionStatus.style.borderColor = "rgba(247, 244, 240, 0.2)";
    } else {
      sessionStatus.textContent = "Session active";
      sessionStatus.style.background = "#1c1917";
      sessionStatus.style.color = "#f7f4f0";
      sessionStatus.style.borderColor = "rgba(247, 244, 240, 0.2)";
    }
  } else {
    sessionStatus.textContent = "No active session";
    sessionStatus.style.background = "#1c1917";
    sessionStatus.style.color = "#a8a29e";
    sessionStatus.style.borderColor = "rgba(247, 244, 240, 0.1)";
  }

  // Daily usage
  const { used, limit } = await checkDailyLimit();
  if (data.isProUser) {
    usageEl.textContent = `${used} sessions used today (Pro)`;
    usageEl.className = "";
  } else {
    usageEl.textContent = `${used}/${limit} sessions used today`;
    usageEl.className = used >= limit ? "limit-reached" : "";
  }
}

// =========================================================================
// Toggle handler
// =========================================================================

toggleIntent.addEventListener("change", async () => {
  if (toggleIntent.checked) {
    // Turning ON — check daily limit
    const { allowed } = await checkDailyLimit();
    if (!allowed) {
      toggleIntent.checked = false;
      sessionStatus.textContent = "You've used your 2 sessions today. Upgrade for unlimited sessions.";
      sessionStatus.style.background = "rgba(239, 68, 68, 0.15)";
      sessionStatus.style.color = "#ef4444";
      sessionStatus.style.borderColor = "rgba(239, 68, 68, 0.3)";
      return;
    }

    const data = await chrome.storage.local.get(["sessionDurationMinutes"]);
    const duration = data.sessionDurationMinutes ?? 25;
    await chrome.runtime.sendMessage({ action: "startSession", durationMinutes: duration });
  } else {
    // Turning OFF
    await chrome.runtime.sendMessage({ action: "endSession" });
  }
  render();
});

// =========================================================================
// Duration selector
// =========================================================================

durButtons.forEach(btn => {
  btn.addEventListener("click", async () => {
    const minutes = Number(btn.dataset.min);
    await chrome.storage.local.set({ sessionDurationMinutes: minutes });
    render();
  });
});

// =========================================================================
// Init
// =========================================================================

render();
setInterval(render, 1000);
