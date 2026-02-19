/**
 * background.js — Service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Seed storage on first install.
 *   2. Forward session state changes to the native app (stub).
 */

importScripts("storage.js", "rules.js");

// =========================================================================
// Lifecycle
// =========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await initializeStorage();
    console.log("[FocusBlocker] Storage initialized on first install.");
  }
});

// =========================================================================
// Native messaging stub (Phase 2)
// =========================================================================

/**
 * Send a message to the native desktop companion app.
 * Currently a no-op stub — Phase 2 will connect via chrome.runtime.connectNative().
 */
function sendToNative(message) {
  console.log("[FocusBlocker] sendToNative:", JSON.stringify(message));
}

// Forward every session state change so the native app can react.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.focusSession) {
    sendToNative({
      type: "SESSION_CHANGED",
      session: changes.focusSession.newValue
    });
  }
});
