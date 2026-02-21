/**
 * popup.js — Drives the extension popup UI.
 *
 * Reads focus session state from storage and lets the user start or
 * stop sessions.  All heavy lifting is delegated to storage.js.
 */

const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btn-start");
const btnEnd = document.getElementById("btn-end");
const chkStrict = document.getElementById("chk-strict");
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

  chkStrict.checked = settings.strictMode;
  chkStrict.disabled = active;

  // Update start button text with configured duration
  btnStart.textContent = `Start Focus Session (${settings.sessionDurationMinutes} min)`;

  if (active) {
    const remaining = Math.max(0, session.endTime - Date.now());
    const minutes = Math.ceil(remaining / 60000);
    const scheduled = session.scheduledId ? " (scheduled)" : "";
    statusEl.textContent = `Session active${scheduled} \u2014 ${minutes} min remaining`;
    btnStart.disabled = true;
    btnEnd.disabled = false;
    btnEnd.textContent = session.locked ? "End Session (PIN Required)" : "End Focus Session";
  } else {
    statusEl.textContent = "No active session.";
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

chkStrict.addEventListener("change", async () => {
  const settings = await getSettings();
  settings.strictMode = chkStrict.checked;
  await setSettings(settings);
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
