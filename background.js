/**
 * background.js — Service worker for Sumi (v3 freemium).
 *
 * No tabs permission. Pause/resume driven by content script messages.
 * Badge shows remaining minutes. Tick alarm as expiry backup.
 */

importScripts("storage.js");

const TICK_ALARM = "intent-mode-tick";
const TICK_INTERVAL_MINUTES = 1 / 6; // 10 seconds

// =========================================================================
// Badge
// =========================================================================

async function updateBadge() {
  const remaining = await getRemainingMs();
  if (remaining == null) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const minutes = Math.ceil(remaining / 60000);
  chrome.action.setBadgeText({ text: String(minutes) });
  chrome.action.setBadgeBackgroundColor({ color: "#4361ee" });
}

// =========================================================================
// Session lifecycle
// =========================================================================

async function startSession(durationMinutes) {
  const endTime = Date.now() + durationMinutes * 60 * 1000;
  await chrome.storage.local.set({
    intentModeEnabled: true,
    sessionEndTime: endTime,
    sessionPausedRemaining: null
  });
  await incrementDailyCount();
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_INTERVAL_MINUTES });
  updateBadge();
}

async function endSession() {
  await chrome.storage.local.set({
    intentModeEnabled: false,
    sessionEndTime: null,
    sessionPausedRemaining: null
  });
  chrome.alarms.clear(TICK_ALARM);
  chrome.action.setBadgeText({ text: "" });
}

async function pauseSession() {
  const data = await chrome.storage.local.get(["intentModeEnabled", "sessionEndTime"]);
  if (!data.intentModeEnabled || data.sessionEndTime == null) return;

  const remaining = Math.max(0, data.sessionEndTime - Date.now());
  await chrome.storage.local.set({
    sessionEndTime: null,
    sessionPausedRemaining: remaining
  });
  updateBadge();
}

async function resumeSession() {
  const data = await chrome.storage.local.get(["intentModeEnabled", "sessionPausedRemaining"]);
  if (!data.intentModeEnabled || data.sessionPausedRemaining == null) return;

  const endTime = Date.now() + data.sessionPausedRemaining;
  await chrome.storage.local.set({
    sessionEndTime: endTime,
    sessionPausedRemaining: null
  });
  updateBadge();
}

// =========================================================================
// Tick — backup expiry check + badge refresh
// =========================================================================

async function tickHandler() {
  const data = await chrome.storage.local.get([
    "intentModeEnabled", "sessionEndTime", "sessionPausedRemaining"
  ]);

  if (!data.intentModeEnabled) {
    chrome.alarms.clear(TICK_ALARM);
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  // If running (not paused) and expired, notify content scripts
  if (data.sessionEndTime != null && Date.now() >= data.sessionEndTime) {
    const ytTabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of ytTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "sessionExpired" });
      } catch { /* content script may not be ready */ }
    }
    return; // content script will call endSession after user dismisses
  }

  updateBadge();
}

// =========================================================================
// Message handler
// =========================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startSession") {
    startSession(msg.durationMinutes).then(() => sendResponse({ status: "OK" }));
    return true;
  }
  if (msg.action === "endSession") {
    endSession().then(() => sendResponse({ status: "OK" }));
    return true;
  }
  if (msg.action === "pauseSession") {
    pauseSession().then(() => sendResponse({ status: "OK" }));
    return true;
  }
  if (msg.action === "resumeSession") {
    resumeSession().then(() => sendResponse({ status: "OK" }));
    return true;
  }
  if (msg.action === "getSessionState") {
    getRemainingMs().then(remaining => {
      chrome.storage.local.get(["intentModeEnabled", "sessionPausedRemaining"]).then(data => {
        sendResponse({
          active: data.intentModeEnabled,
          paused: data.sessionPausedRemaining != null,
          remainingMs: remaining
        });
      });
    });
    return true;
  }
});

// =========================================================================
// Storage change listener — handle toggle OFF from popup
// =========================================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.intentModeEnabled) {
    const wasEnabled = changes.intentModeEnabled.oldValue ?? false;
    const isEnabled = changes.intentModeEnabled.newValue ?? false;

    if (wasEnabled && !isEnabled) {
      // Session ended (toggle OFF or endSession call)
      chrome.alarms.clear(TICK_ALARM);
      chrome.action.setBadgeText({ text: "" });
    } else if (!wasEnabled && isEnabled) {
      // Session started — ensure tick alarm is running
      chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_INTERVAL_MINUTES });
      updateBadge();
    }
  }
});

// =========================================================================
// Alarm listener
// =========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TICK_ALARM) {
    await tickHandler();
  }
});

// =========================================================================
// Lifecycle
// =========================================================================

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
});

// Startup — recover active session
(async () => {
  const data = await chrome.storage.local.get(["intentModeEnabled"]);
  if (data.intentModeEnabled) {
    chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_INTERVAL_MINUTES });
    updateBadge();
  }
})();
