/**
 * popup.js — Drives the extension popup UI.
 *
 * Reads focus session state from storage and lets the user start,
 * stop, or switch modes. All heavy lifting is delegated to background.js
 * via chrome.runtime.sendMessage.
 */

const statusEl = document.getElementById("status");
const modeInfo = document.getElementById("mode-info");
const modeLabel = document.getElementById("mode-label");
const linkSwitchMode = document.getElementById("link-switch-mode");
const btnStart = document.getElementById("btn-start");
const btnEnd = document.getElementById("btn-end");
const pinSection = document.getElementById("pin-section");
const pinInput = document.getElementById("pin-input");
const btnPinSubmit = document.getElementById("btn-pin-submit");
const pinError = document.getElementById("pin-error");
const linkOptions = document.getElementById("link-options");

/** Render the current session state into the popup. */
async function renderStatus() {
  const session = await getActiveSession();
  const active = await isSessionActive();
  const settings = await getSettings();

  // Update start button text with configured duration
  btnStart.textContent = `Start Focus Session (${settings.sessionDurationMinutes} min)`;

  if (active) {
    const remaining = Math.max(0, session.endTime - Date.now());
    const minutes = Math.ceil(remaining / 60000);
    const scheduled = session.scheduledId ? " (scheduled)" : "";
    const modeName = session.mode === "strict" ? "Strict" : "Precision";
    statusEl.textContent = `${modeName} mode${scheduled} \u2014 ${minutes} min remaining`;

    // Show mode indicator with switch link
    modeInfo.style.display = "block";
    modeLabel.textContent = `${modeName} mode`;
    const otherMode = session.mode === "strict" ? "precision" : "strict";
    const otherLabel = session.mode === "strict" ? "Precision" : "Strict";
    linkSwitchMode.textContent = `Switch to ${otherLabel}`;
    linkSwitchMode.dataset.targetMode = otherMode;

    btnStart.disabled = true;
    btnEnd.disabled = false;
    btnEnd.textContent = session.locked ? "End Session (PIN Required)" : "End Focus Session";
  } else {
    statusEl.textContent = "No active session.";
    modeInfo.style.display = "none";
    btnStart.disabled = false;
    btnEnd.disabled = true;
    btnEnd.textContent = "End Focus Session";
    // Hide PIN section when no session
    pinSection.style.display = "none";
    pinInput.value = "";
    pinError.textContent = "";
  }
}

btnStart.addEventListener("click", async () => {
  const settings = await getSettings();
  await startFocusSession(settings.sessionDurationMinutes);
  renderStatus();
});

linkSwitchMode.addEventListener("click", async () => {
  const targetMode = linkSwitchMode.dataset.targetMode;
  if (!targetMode) return;

  linkSwitchMode.textContent = "Switching...";
  linkSwitchMode.disabled = true;

  const result = await switchMode(targetMode);

  if (result && result.status === "ERROR") {
    linkSwitchMode.textContent = result.message || "Switch failed";
    setTimeout(renderStatus, 2000);
    return;
  }

  renderStatus();
});

btnEnd.addEventListener("click", async () => {
  const session = await getActiveSession();

  if (session.locked) {
    // Show PIN input instead of ending directly
    pinSection.style.display = "block";
    pinInput.focus();
    return;
  }

  await endFocusSession();
  renderStatus();
});

btnPinSubmit.addEventListener("click", async () => {
  const pin = pinInput.value;
  if (!pin) return;

  // Send PIN to background → native app for verification
  const result = await endFocusSession({ parentApproved: true, parentPin: pin });

  if (result && result.status === "ERROR") {
    pinError.textContent = result.message || "Incorrect PIN.";
    pinInput.value = "";
    pinInput.focus();
    return;
  }

  pinSection.style.display = "none";
  pinInput.value = "";
  pinError.textContent = "";
  renderStatus();
});

pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnPinSubmit.click();
});

linkOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Initial render.
renderStatus();

// Keep the display fresh while the popup is open.
setInterval(renderStatus, 5000);
