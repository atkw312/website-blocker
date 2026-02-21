/**
 * background.js — Service worker (Manifest V3).
 *
 * Mode-based state machine orchestrator.
 *
 * Responsibilities:
 *   1. Seed storage on first install.
 *   2. Always-on native messaging connection to focus-blocker-native.
 *   3. Poll GET_STATE every 5s and sync shared state into chrome.storage.local.
 *   4. transitionMode() dispatcher for 6 allowed transitions.
 *   5. Push rule/settings changes from storage → native app.
 *   6. Keep the service worker alive during active sessions (MV3 alarms).
 *
 * Transitions:
 *   off → precision   startSession (defaultMode = precision)
 *   off → strict      startSession (defaultMode = strict)
 *   precision → strict   switchMode mid-session
 *   strict → precision   switchMode mid-session
 *   precision → off      endSession / expiry
 *   strict → off         endSession / expiry
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
    setTimeout(() => { syncingFromNative = false; }, 100);
  }
}

/**
 * Write native app state into chrome.storage.local.
 * Only updates keys that actually changed to minimize storage events.
 */
async function syncStateFromNative(state) {
  const updates = {};

  // Session state (mode-based)
  if (state.session) {
    const current = await getActiveSession();
    const native = state.session;
    if (
      current.mode !== (native.mode ?? "off") ||
      current.startTime !== native.startTime ||
      current.endTime !== native.endTime ||
      current.locked !== native.locked ||
      current.scheduledId !== native.scheduledId
    ) {
      updates.focusSession = {
        mode: native.mode ?? "off",
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

  // Settings (mode-based)
  if (state.settings) {
    const current = await getSettings();
    const native = state.settings;
    let changed = false;
    if (native.defaultMode !== undefined && current.defaultMode !== native.defaultMode) {
      current.defaultMode = native.defaultMode;
      changed = true;
    }
    if (native.blockAllChannels !== undefined && current.blockAllChannels !== native.blockAllChannels) {
      current.blockAllChannels = native.blockAllChannels;
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
// Mode transition dispatcher
// =========================================================================

/**
 * Validate and dispatch a mode transition.
 *
 * @param {string} from       Current mode ("off"|"precision"|"strict")
 * @param {string} to         Target mode ("off"|"precision"|"strict")
 * @param {object} [params]   Extra params (durationMinutes, scheduledId, natural, parentPin, etc.)
 * @returns {Promise<object>}  Result with { status, session?, error? }
 */
async function transitionMode(from, to, params = {}) {
  const key = `${from}->${to}`;
  console.log(LOG_PREFIX, `Transition: ${key}`, params);

  switch (key) {
    case "off->precision":
      return startPrecisionSession(params);
    case "off->strict":
      return startStrictSession(params);
    case "precision->strict":
      return switchToStrict();
    case "strict->precision":
      return switchToPrecision();
    case "precision->off":
      return endPrecisionSession(params);
    case "strict->off":
      return endStrictSession(params);
    default:
      console.warn(LOG_PREFIX, `Invalid transition: ${key}`);
      return { status: "ERROR", message: `Invalid transition: ${key}` };
  }
}

/** off → precision: extension-only channel blocking */
async function startPrecisionSession(params) {
  const settings = await getSettings();
  const duration = params.durationMinutes ?? settings.sessionDurationMinutes;
  const locked = settings.requireParentUnlock && !!settings.parentPinHash;
  const now = Date.now();

  const session = {
    mode: "precision",
    startTime: now,
    endTime: now + duration * 60 * 1000,
    locked,
    scheduledId: params.scheduledId ?? null
  };

  // Write to local storage first (content.js picks this up)
  await chrome.storage.local.set({ focusSession: session });

  // Notify native for cross-profile sync (no enforcement)
  const response = await sendNativeMessage({
    type: "START_SESSION",
    mode: "precision",
    durationMinutes: duration,
    scheduledId: params.scheduledId ?? null,
    locked,
  });

  // If native responded with session data, use it as source of truth
  if (response?.status === "OK" && response.session) {
    syncingFromNative = true;
    await chrome.storage.local.set({
      focusSession: {
        mode: response.session.mode ?? "precision",
        startTime: response.session.startTime ?? session.startTime,
        endTime: response.session.endTime ?? session.endTime,
        locked: response.session.locked ?? session.locked,
        scheduledId: response.session.scheduledId ?? session.scheduledId,
      }
    });
    setTimeout(() => { syncingFromNative = false; }, 100);
  }

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  updateBadge();

  return { status: "OK", session };
}

/** off → strict: hosts-level blocking via native */
async function startStrictSession(params) {
  const settings = await getSettings();
  const duration = params.durationMinutes ?? settings.sessionDurationMinutes;
  const locked = settings.requireParentUnlock && !!settings.parentPinHash;

  // Send to native FIRST (blocks hosts)
  const response = await sendNativeMessage({
    type: "START_SESSION",
    mode: "strict",
    durationMinutes: duration,
    scheduledId: params.scheduledId ?? null,
    locked,
  });

  if (!response || response.status !== "OK") {
    // Fallback: if native unavailable, start as precision instead
    console.warn(LOG_PREFIX, "Native START_SESSION (strict) failed, falling back to precision.");
    return startPrecisionSession(params);
  }

  // Write session from native response to storage
  const session = response.session ?? {
    mode: "strict",
    startTime: Date.now(),
    endTime: Date.now() + duration * 60 * 1000,
    locked,
    scheduledId: params.scheduledId ?? null
  };

  syncingFromNative = true;
  await chrome.storage.local.set({
    focusSession: {
      mode: session.mode ?? "strict",
      startTime: session.startTime ?? null,
      endTime: session.endTime ?? null,
      locked: session.locked ?? false,
      scheduledId: session.scheduledId ?? null,
    }
  });
  setTimeout(() => { syncingFromNative = false; }, 100);

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  updateBadge();

  return { status: "OK", session };
}

/** precision → strict: switch mid-session */
async function switchToStrict() {
  // Write mode to storage first (content.js stops precision immediately)
  const session = await getActiveSession();
  session.mode = "strict";
  await chrome.storage.local.set({ focusSession: session });

  // Send to native (blocks hosts)
  const response = await sendNativeMessage({
    type: "SWITCH_MODE",
    mode: "strict",
  });

  if (!response || response.status !== "OK") {
    // Revert storage on failure
    console.warn(LOG_PREFIX, "Native SWITCH_MODE (strict) failed, reverting to precision.");
    session.mode = "precision";
    await chrome.storage.local.set({ focusSession: session });
    return { status: "ERROR", message: "Failed to switch to strict mode. Native app unavailable." };
  }

  return { status: "OK", mode: "strict" };
}

/** strict → precision: switch mid-session */
async function switchToPrecision() {
  // Send to native FIRST (unblocks hosts)
  const response = await sendNativeMessage({
    type: "SWITCH_MODE",
    mode: "precision",
  });

  if (!response || response.status !== "OK") {
    // Keep strict on failure
    console.warn(LOG_PREFIX, "Native SWITCH_MODE (precision) failed, keeping strict.");
    return { status: "ERROR", message: "Failed to switch to precision mode. Native app unavailable." };
  }

  // THEN write to storage (content.js starts precision)
  const session = await getActiveSession();
  session.mode = "precision";
  await chrome.storage.local.set({ focusSession: session });

  return { status: "OK", mode: "precision" };
}

/** precision → off: end session (no hosts cleanup needed) */
async function endPrecisionSession(params) {
  const session = await getActiveSession();

  // Record history + stats before clearing
  if (session.startTime) {
    const now = Date.now();
    const actualMinutes = Math.round((now - session.startTime) / 60000);
    const durationMinutes = session.endTime
      ? Math.round((session.endTime - session.startTime) / 60000)
      : actualMinutes;
    await recordSession({
      startTime: session.startTime,
      endTime: now,
      durationMinutes,
      actualMinutes,
      completedNaturally: params.natural ?? false,
      scheduledId: session.scheduledId ?? null,
    });
    await updateStatsAfterSession(actualMinutes);
  }

  // Clear session
  await chrome.storage.local.set({
    focusSession: { mode: "off", startTime: null, endTime: null, locked: false, scheduledId: null }
  });

  // Notify native (clears session state, no hosts to clean)
  await sendNativeMessage({ type: "END_SESSION", natural: params.natural ?? false });

  chrome.alarms.clear(KEEPALIVE_ALARM);
  chrome.action.setBadgeText({ text: "" });

  return { status: "OK" };
}

/** strict → off: end session (hosts cleanup via native FIRST) */
async function endStrictSession(params) {
  const session = await getActiveSession();

  // Check lock — for non-natural endings
  if (!params.natural && session.locked) {
    if (!params.parentPin) {
      return { status: "ERROR", message: "Session is locked. PIN required." };
    }
  }

  // Send END_SESSION to native FIRST (unblocks hosts)
  const response = await sendNativeMessage({
    type: "END_SESSION",
    natural: params.natural ?? false,
    parentPin: params.parentPin ?? "",
  });

  if (!response || response.status !== "OK") {
    if (response?.message) {
      return response; // pass error (e.g. "Invalid PIN") to popup
    }
    // Native unavailable — still end locally but warn
    console.warn(LOG_PREFIX, "Native END_SESSION (strict) failed, ending locally.");
  }

  // Record history + stats
  if (session.startTime) {
    const now = Date.now();
    const actualMinutes = Math.round((now - session.startTime) / 60000);
    const durationMinutes = session.endTime
      ? Math.round((session.endTime - session.startTime) / 60000)
      : actualMinutes;
    await recordSession({
      startTime: session.startTime,
      endTime: now,
      durationMinutes,
      actualMinutes,
      completedNaturally: params.natural ?? false,
      scheduledId: session.scheduledId ?? null,
    });
    await updateStatsAfterSession(actualMinutes);
  }

  // Clear session
  syncingFromNative = true;
  await chrome.storage.local.set({
    focusSession: { mode: "off", startTime: null, endTime: null, locked: false, scheduledId: null }
  });
  setTimeout(() => { syncingFromNative = false; }, 100);

  chrome.alarms.clear(KEEPALIVE_ALARM);
  chrome.action.setBadgeText({ text: "" });

  return { status: "OK" };
}

// =========================================================================
// Internal message handler — popup.js → background → transitionMode
// =========================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startSession") {
    handleStartSession(msg).then(sendResponse);
    return true;
  }
  if (msg.action === "endSession") {
    handleEndSession(msg).then(sendResponse);
    return true;
  }
  if (msg.action === "switchMode") {
    handleSwitchMode(msg).then(sendResponse);
    return true;
  }
});

async function handleStartSession(msg) {
  const settings = await getSettings();
  const targetMode = settings.defaultMode ?? "precision";
  return transitionMode("off", targetMode, {
    durationMinutes: msg.durationMinutes ?? settings.sessionDurationMinutes,
    scheduledId: msg.scheduledId ?? null,
  });
}

async function handleEndSession(msg) {
  const session = await getActiveSession();
  const currentMode = session.mode ?? "off";

  if (currentMode === "off") {
    return { status: "OK" }; // already off
  }

  return transitionMode(currentMode, "off", {
    natural: msg.natural ?? false,
    parentApproved: msg.parentApproved ?? false,
    parentPin: msg.parentPin ?? "",
  });
}

async function handleSwitchMode(msg) {
  const session = await getActiveSession();
  const currentMode = session.mode ?? "off";
  const targetMode = msg.targetMode;

  if (currentMode === "off") {
    return { status: "ERROR", message: "No active session." };
  }

  if (currentMode === targetMode) {
    return { status: "OK", mode: currentMode };
  }

  return transitionMode(currentMode, targetMode);
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
      defaultMode: settings.defaultMode ?? "precision",
      blockAllChannels: settings.blockAllChannels ?? false,
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
  if (!session.mode || session.mode === "off" || !session.endTime) {
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

  // --- Focus session mode changed ---
  if (changes.focusSession) {
    const oldMode = changes.focusSession.oldValue?.mode ?? "off";
    const newMode = changes.focusSession.newValue?.mode ?? "off";

    const wasActive = oldMode !== "off";
    const isActive = newMode !== "off";

    if (!wasActive && isActive) {
      // Session started
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
      updateBadge();
      console.log(LOG_PREFIX, `Session started (${newMode}).`);
    } else if (wasActive && !isActive) {
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
    } else if (wasActive && isActive && oldMode !== newMode) {
      // Mode switched mid-session
      console.log(LOG_PREFIX, `Mode switched: ${oldMode} → ${newMode}`);
    }
  }

  // --- Block rules changed (user action, not sync) → push to native ---
  if (changes.blockRules) {
    pushRulesToNative();
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
