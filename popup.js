/**
 * popup.js — Drives the extension popup UI.
 *
 * Reads focus session state from storage and lets the user start or
 * stop sessions.  All heavy lifting is delegated to storage.js.
 */

const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btn-start");
const btnEnd = document.getElementById("btn-end");

/** Render the current session state into the popup. */
async function renderStatus() {
  const session = await getFocusSession();
  const active = await isFocusActive();

  if (active) {
    const remaining = Math.max(0, session.endTime - Date.now());
    const minutes = Math.ceil(remaining / 60000);
    statusEl.textContent = `Session active — ${minutes} min remaining`;
    btnStart.disabled = true;
    btnEnd.disabled = false;
  } else {
    statusEl.textContent = "No active session.";
    btnStart.disabled = false;
    btnEnd.disabled = true;
  }
}

btnStart.addEventListener("click", async () => {
  await startFocusSession(30);
  renderStatus();
});

btnEnd.addEventListener("click", async () => {
  await endFocusSession();
  renderStatus();
});

// Initial render.
renderStatus();

// Keep the display fresh while the popup is open.
setInterval(renderStatus, 5000);
