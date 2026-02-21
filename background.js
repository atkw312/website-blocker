/**
 * background.js — Service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Seed storage on first install.
 *   2. Always-on native messaging connection to focus-blocker-native.
 *   3. Poll GET_STATE every 5s and sync shared state into chrome.storage.local.
 *   4. Forward startSession/endSession from popup → native app.
 *   5. Push rule/settings changes from storage → native app.
 *   6. Keep the service worker alive during active sessions (MV3 alarms).
 */

importScripts("storage.js", "rules.js");

const NATIVE_HOST = "com.focusblocker.native";
const LOG_PREFIX = "[FocusBlocker]";
const KEEPALIVE_ALARM = "focusblocker-keepalive";
const SCHEDULE_CHECK_ALARM = "focusblocker-schedule-check";
const POLL_INTERVAL_MS = 5000;

let nativePort = null;
let pollTimer = null;

/**
 * Guard flag: when true, storage writes originated from a GET_STATE sync
 * and should NOT be re-pushed back to the native app.
 */
let syncingFromNative = false;

// =========================================================================
// Lifecycle
// =========================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    await initializeStorage();
    console.log(LOG_PREFIX, "Storage initialized on", details.reason);
  }
  chrome.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 1 });
});

// =========================================================================
// Native messaging — connection management
// =========================================================================

function connectNative() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    console.warn(LOG_PREFIX, "connectNative failed:", e);
    nativePort = null;
    scheduleReconnect();
    return;
  }

  console.log(LOG_PREFIX, "Connected to native app.");

  nativePort.onMessage.addListener((msg) => {
    console.log(LOG_PREFIX, "Native:", JSON.stringify(msg).slice(0, 200));
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    console.warn(LOG_PREFIX, "Native port disconnected.", err ?? "");
    nativePort = null;
    stopPolling();
    scheduleReconnect();
  });

  startPolling();
}

function disconnectNative() {
  stopPolling();
  if (!nativePort) return;
  try {
    nativePort.disconnect();
  } catch (_) {
    // port may already be dead
  }
  nativePort = null;
  console.log(LOG_PREFIX, "Disconnected from native app.");
}

function scheduleReconnect() {
  setTimeout(() => {
    console.log(LOG_PREFIX, "Attempting reconnect...");
    connectNative();
  }, 5000);
}

/**
 * Send a message to the native app via one-shot sendNativeMessage and
 * return a Promise that resolves with the response.
 */
function sendNativeMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(LOG_PREFIX, "sendNativeMessage error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (e) {
      console.warn(LOG_PREFIX, "sendNativeMessage exception:", e);
      resolve(null);
    }
  });
}

function sendToPort(msg) {
  if (!nativePort) {
    console.warn(LOG_PREFIX, "sendToPort: no active port.");
    return;
  }
  try {
    nativePort.postMessage(msg);
  } catch (e) {
    console.error(LOG_PREFIX, "sendToPort error:", e);
    nativePort = null;
  }
}

// =========================================================================
// GET_STATE polling — sync native config → chrome.storage.local
// =========================================================================

function startPolling() {
  if (pollTimer) return;
  pollState(); // immediate first poll
  pollTimer = setInterval(pollState, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollState() {
  const response = await sendNativeMessage({ type: "GET_STATE" });
  if (!response || response.status !== "OK") return;

  syncingFromNative = true;
  try {
    await syncStateFromNative(response);
  } finally {
    // Small delay before clearing the flag to ensure storage.onChanged
    // listeners see it before we reset.
    setTimeout(() => { syncingFromNative = false; }, 100);
  }
}

/**
 * Write native app state into chrome.storage.local.
 * Only updates keys that actually changed to minimize storage events.
 */
async function syncStateFromNative(state) {
  const updates = {};

  // Session state
  if (state.session) {
    const current = await getActiveSession();
    const native = state.session;
    if (
      current.active !== native.active ||
      current.startTime !== native.startTime ||
      current.endTime !== native.endTime ||
      current.locked !== native.locked ||
      current.scheduledId !== native.scheduledId
    ) {
      updates.focusSession = {
        active: native.active ?? false,
        startTime: native.startTime ?? null,
        endTime: native.endTime ?? null,
        locked: native.locked ?? false,
        scheduledId: native.scheduledId ?? null,
      };
    }
  }

  // YouTube rules
  if (state.youtubeRules) {
    const rules = await getBlockRules();
    const native = state.youtubeRules;
    if (
      JSON.stringify(rules.youtube.blockedChannels) !== JSON.stringify(native.blockedChannels) ||
      JSON.stringify(rules.youtube.allowedChannels) !== JSON.stringify(native.allowedChannels)
    ) {
      rules.youtube.blockedChannels = native.blockedChannels ?? [];
      rules.youtube.allowedChannels = native.allowedChannels ?? [];
      updates.blockRules = rules;
    }
  }

  // Blocked domains → blockedSites
  if (state.blockedDomains) {
    const rules = updates.blockRules ?? await getBlockRules();
    if (JSON.stringify(rules.blockedSites) !== JSON.stringify(state.blockedDomains)) {
      rules.blockedSites = state.blockedDomains;
      updates.blockRules = rules;
    }
  }

  // Settings
  if (state.settings) {
    const current = await getSettings();
    const native = state.settings;
    let changed = false;
    if (native.strictMode !== undefined && current.strictMode !== native.strictMode) {
      current.strictMode = native.strictMode;
      changed = true;
    }
    if (native.blockYoutubeFallback !== undefined && current.blockYoutubeFallback !== native.blockYoutubeFallback) {
      current.blockYoutubeFallback = native.blockYoutubeFallback;
      changed = true;
    }
    if (native.sessionDurationMinutes !== undefined && current.sessionDurationMinutes !== native.sessionDurationMinutes) {
      current.sessionDurationMinutes = native.sessionDurationMinutes;
      changed = true;
    }
    if (changed) {
      updates.settings = current;
    }
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// =========================================================================
// Internal message handler — popup.js → background → native
// =========================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startSession") {
    handleStartSession(msg).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (msg.action === "endSession") {
    handleEndSession(msg).then(sendResponse);
    return true;
  }
});

async function handleStartSession(msg) {
  const settings = await getSettings();
  const duration = msg.durationMinutes ?? settings.sessionDurationMinutes;
  const locked = settings.requireParentUnlock && !!settings.parentPinHash;

  const response = await sendNativeMessage({
    type: "START_SESSION",
    durationMinutes: duration,
    scheduledId: msg.scheduledId ?? null,
    locked,
  });

  if (!response || response.status !== "OK") {
    // Fallback: start locally if native app is unavailable
    console.warn(LOG_PREFIX, "Native START_SESSION failed, starting locally.");
    const session = await startFocusSessionLocal(duration, { scheduledId: msg.scheduledId });
    return { status: "OK", session };
  }

  // Write the session from native response into local storage
  if (response.session) {
    syncingFromNative = true;
    await chrome.storage.local.set({ focusSession: response.session });
    setTimeout(() => { syncingFromNative = false; }, 100);
  }

  return response;
}

async function handleEndSession(msg) {
  const response = await sendNativeMessage({
    type: "END_SESSION",
    natural: msg.natural ?? false,
    parentPin: msg.parentPin ?? "",
  });

  if (!response || response.status !== "OK") {
    if (response?.message) {
      return response; // pass error (e.g. "Invalid PIN") to popup
    }
    // Fallback: end locally if native app is unavailable
    console.warn(LOG_PREFIX, "Native END_SESSION failed, ending locally.");
    await endFocusSessionLocal({
      parentApproved: msg.parentApproved ?? false,
      natural: msg.natural ?? false,
    });
    return { status: "OK" };
  }

  // Clear local session state
  syncingFromNative = true;
  await chrome.storage.local.set({
    focusSession: { active: false, startTime: null, endTime: null, locked: false, scheduledId: null }
  });
  setTimeout(() => { syncingFromNative = false; }, 100);

  // Record history locally
  const oldSession = await getActiveSession();
  if (oldSession.startTime) {
    const now = Date.now();
    const actualMinutes = Math.round((now - oldSession.startTime) / 60000);
    const durationMinutes = oldSession.endTime
      ? Math.round((oldSession.endTime - oldSession.startTime) / 60000)
      : actualMinutes;
    await recordSession({
      startTime: oldSession.startTime,
      endTime: now,
      durationMinutes,
      actualMinutes,
      completedNaturally: msg.natural ?? false,
      scheduledId: oldSession.scheduledId ?? null,
    });
    await updateStatsAfterSession(actualMinutes);
  }

  return response;
}

// =========================================================================
// Domain sync helpers (for strict mode hosts-file blocking)
// =========================================================================

function blockDomain(domain) {
  sendToPort({ type: "BLOCK_DOMAIN", domain });
}

function unblockDomain(domain) {
  sendToPort({ type: "UNBLOCK_DOMAIN", domain });
}

async function syncAllDomains() {
  const rules = await getBlockRules();
  const sites = rules.blockedSites ?? [];
  for (const domain of sites) {
    blockDomain(domain);
  }
}

async function unblockAllDomains() {
  const rules = await getBlockRules();
  const sites = rules.blockedSites ?? [];
  for (const domain of sites) {
    unblockDomain(domain);
  }
}

// =========================================================================
// Push local changes → native app
// =========================================================================

async function pushRulesToNative() {
  const rules = await getBlockRules();
  await sendNativeMessage({
    type: "SYNC_RULES",
    youtubeRules: {
      blockedChannels: rules.youtube.blockedChannels,
      allowedChannels: rules.youtube.allowedChannels,
    },
    blockedSites: rules.blockedSites,
  });
}

async function pushSettingsToNative() {
  const settings = await getSettings();
  await sendNativeMessage({
    type: "SYNC_SETTINGS",
    settings: {
      strictMode: settings.strictMode,
      blockYoutubeFallback: settings.blockYoutubeFallback ?? false,
      sessionDurationMinutes: settings.sessionDurationMinutes,
    },
  });
}

// =========================================================================
// Schedule engine
// =========================================================================

async function checkSchedules() {
  const active = await isSessionActive();
  if (active) return;

  const schedules = await getSchedules();
  const now = new Date();
  const day = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (!schedule.days.includes(day)) continue;

    const startMinutes = schedule.startHour * 60 + schedule.startMinute;
    const endMinutes = schedule.endHour * 60 + schedule.endMinute;

    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      const remainingMinutes = endMinutes - currentMinutes;
      console.log(LOG_PREFIX, `Schedule "${schedule.label}" triggered — ${remainingMinutes} min remaining.`);
      await handleStartSession({ durationMinutes: remainingMinutes, scheduledId: schedule.id });
      return; // first match wins
    }
  }
}

// =========================================================================
// Badge
// =========================================================================

async function updateBadge() {
  const session = await getActiveSession();
  if (!session.active || !session.endTime) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const remaining = Math.max(0, session.endTime - Date.now());
  const minutes = Math.ceil(remaining / 60000);
  chrome.action.setBadgeText({ text: String(minutes) });
  chrome.action.setBadgeBackgroundColor({ color: "#4361ee" });
}

// =========================================================================
// Session state change handler
// =========================================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  // Skip if this change came from native sync
  if (syncingFromNative) return;

  // --- Focus session toggled ---
  if (changes.focusSession) {
    const oldActive = changes.focusSession.oldValue?.active ?? false;
    const newActive = changes.focusSession.newValue?.active ?? false;

    if (!oldActive && newActive) {
      // Session started
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
      updateBadge();
      console.log(LOG_PREFIX, "Session started.");
    } else if (oldActive && !newActive) {
      // Session ended
      chrome.alarms.clear(KEEPALIVE_ALARM);
      chrome.action.setBadgeText({ text: "" });

      // Notification on natural expiry
      const oldEnd = changes.focusSession.oldValue?.endTime;
      if (oldEnd && oldEnd <= Date.now()) {
        try {
          chrome.notifications.create("session-complete", {
            type: "basic",
            title: "Focus Session Complete",
            message: "Great work! Your focus session has ended.",
            iconUrl: "icon128.png"
          });
        } catch (_) { /* icon may not exist */ }
      }

      console.log(LOG_PREFIX, "Session ended — keepalive cleared.");
    }
  }

  // --- Block rules changed (user action, not sync) → push to native ---
  if (changes.blockRules) {
    pushRulesToNative();

    // Also handle strict-mode domain sync for active sessions
    const session = await getActiveSession();
    if (session.active && nativePort) {
      const oldSites = new Set(changes.blockRules.oldValue?.blockedSites ?? []);
      const newSites = new Set(changes.blockRules.newValue?.blockedSites ?? []);

      for (const domain of newSites) {
        if (!oldSites.has(domain)) blockDomain(domain);
      }
      for (const domain of oldSites) {
        if (!newSites.has(domain)) unblockDomain(domain);
      }
    }
  }

  // --- Settings changed (user action) → push to native ---
  if (changes.settings) {
    pushSettingsToNative();
  }
});

// =========================================================================
// Service worker resilience (MV3 alarms keepalive)
// =========================================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SCHEDULE_CHECK_ALARM) {
    await checkSchedules();
    return;
  }

  if (alarm.name !== KEEPALIVE_ALARM) return;

  const active = await isSessionActive();
  if (!active) {
    chrome.alarms.clear(KEEPALIVE_ALARM);
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  updateBadge();

  // Ensure native connection is alive
  if (!nativePort) {
    connectNative();
  } else {
    sendToPort({ type: "PING" });
  }
});

// =========================================================================
// Startup — always connect to native app + resume session if active
// =========================================================================

(async () => {
  // Ensure schedule check alarm is always running
  chrome.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 1 });

  // Always connect to native app for cross-profile sync
  connectNative();

  const active = await isSessionActive();
  if (active) {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
    updateBadge();
    console.log(LOG_PREFIX, "Startup: active session, connected to native app.");
  } else {
    await checkSchedules();
  }
})();
