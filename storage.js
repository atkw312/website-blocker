/**
 * storage.js — Chrome storage abstraction layer.
 *
 * All persistent state lives in chrome.storage.local.
 * Schema is preserved for forward-compatibility with the native desktop app.
 */

const DEFAULT_STORAGE = {
  blockRules: {
    youtube: {
      blockedChannels: [],
      allowedChannels: []
    },
    reddit: {
      blockedSubreddits: [],
      allowedSubreddits: []
    },
    blockedSites: []
  },
  focusSession: {
    active: false,
    startTime: null,
    endTime: null,
    locked: false,
    scheduledId: null
  },
  settings: {
    strictMode: false,
    requireParentUnlock: false,
    parentPinHash: null,
    sessionDurationMinutes: 30,
    blockYoutubeFallback: false,
    blockAllYouTube: false
  },
  schedules: [],
  // { id, label, days: [0-6], startHour, startMinute, endHour, endMinute, enabled }
  sessionHistory: [],
  // { startTime, endTime, durationMinutes, actualMinutes, completedNaturally, scheduledId }
  stats: {
    totalSessions: 0,
    totalFocusMinutes: 0,
    currentStreak: 0,
    lastSessionDate: null   // "YYYY-MM-DD" local date
  }
};

/**
 * Seed storage with defaults if no data exists yet.
 * Called once on extension install.
 */
async function initializeStorage() {
  const data = await chrome.storage.local.get(null);
  const merged = {};

  for (const key of Object.keys(DEFAULT_STORAGE)) {
    if (data[key] !== undefined && typeof DEFAULT_STORAGE[key] === "object" && !Array.isArray(DEFAULT_STORAGE[key])) {
      merged[key] = { ...DEFAULT_STORAGE[key], ...data[key] };
    } else {
      merged[key] = data[key] !== undefined ? data[key] : DEFAULT_STORAGE[key];
    }
  }

  await chrome.storage.local.set(merged);
  return merged;
}

/** Return the current settings object. */
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return settings ?? DEFAULT_STORAGE.settings;
}

/** Overwrite the entire settings object. */
async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/** Hash a PIN string using SHA-256 via Web Crypto, returns hex string. */
async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify a PIN against a stored SHA-256 hex hash. */
async function verifyPin(pin, storedHash) {
  const hash = await hashPin(pin);
  return hash === storedHash;
}

/** Return the current blockRules object. */
async function getBlockRules() {
  const { blockRules } = await chrome.storage.local.get("blockRules");
  return blockRules ?? DEFAULT_STORAGE.blockRules;
}

/** Overwrite the entire blockRules object. */
async function setBlockRules(rules) {
  await chrome.storage.local.set({ blockRules: rules });
}

/** Return the current focusSession object. */
async function getActiveSession() {
  const { focusSession } = await chrome.storage.local.get("focusSession");
  return focusSession ?? DEFAULT_STORAGE.focusSession;
}

/**
 * Check whether a focus session is currently running.
 * Auto-expires sessions whose endTime has passed.
 * Natural expiry bypasses the lock — the session simply ran out.
 */
async function isSessionActive() {
  const session = await getActiveSession();
  if (!session.active) return false;

  if (session.endTime && Date.now() >= session.endTime) {
    await endFocusSession({ natural: true });
    return false;
  }

  return true;
}

/**
 * Start a focus session by routing through the background service worker,
 * which forwards to the native app for cross-profile sync.
 */
async function startFocusSession(durationMinutes, { scheduledId } = {}) {
  // In content script context, chrome.runtime.sendMessage goes to background.
  // In background context, handleStartSession is called directly.
  if (typeof chrome.runtime.sendMessage === "function" && typeof handleStartSession === "undefined") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "startSession", durationMinutes, scheduledId: scheduledId ?? null },
        (response) => resolve(response)
      );
    });
  }
  // Fallback: direct local write (background context or native unavailable)
  return startFocusSessionLocal(durationMinutes, { scheduledId });
}

/**
 * End the current focus session by routing through the background service worker,
 * which forwards to the native app for cross-profile sync.
 *
 * @param {object} opts
 * @param {boolean} opts.parentApproved - True if parent PIN was verified
 * @param {string}  opts.parentPin      - PIN to send to native for verification
 * @param {boolean} opts.natural        - True if session expired naturally
 * @returns {Promise<object>} Response from native app, or { status: "OK" } on local fallback
 */
async function endFocusSession({ parentApproved = false, parentPin = "", natural = false } = {}) {
  if (typeof chrome.runtime.sendMessage === "function" && typeof handleEndSession === "undefined") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "endSession", parentApproved, parentPin, natural },
        (response) => resolve(response)
      );
    });
  }
  // Fallback: direct local write
  return endFocusSessionLocal({ parentApproved, natural });
}

// ---- Local fallback implementations (used by background.js when native is unavailable) ----

/** Begin a new focus session locally (direct storage write). */
async function startFocusSessionLocal(durationMinutes, { scheduledId } = {}) {
  const settings = await getSettings();
  const now = Date.now();
  const session = {
    active: true,
    startTime: now,
    endTime: now + durationMinutes * 60 * 1000,
    locked: settings.requireParentUnlock && !!settings.parentPinHash,
    scheduledId: scheduledId ?? null
  };
  await chrome.storage.local.set({ focusSession: session });
  return session;
}

/**
 * End the current focus session locally (direct storage write).
 * Returns true if ended successfully, false if the session is locked.
 */
async function endFocusSessionLocal({ parentApproved = false, natural = false } = {}) {
  const session = await getActiveSession();
  if (!session.active) return true;
  if (!natural && session.locked && !parentApproved) return false;

  // Record session history and update stats before clearing
  const now = Date.now();
  const actualMinutes = Math.round((now - session.startTime) / 60000);
  const durationMinutes = Math.round((session.endTime - session.startTime) / 60000);

  await recordSession({
    startTime: session.startTime,
    endTime: now,
    durationMinutes,
    actualMinutes,
    completedNaturally: natural,
    scheduledId: session.scheduledId ?? null
  });
  await updateStatsAfterSession(actualMinutes);

  await chrome.storage.local.set({
    focusSession: { active: false, startTime: null, endTime: null, locked: false, scheduledId: null }
  });
  return true;
}

// =========================================================================
// Schedules CRUD
// =========================================================================

async function getSchedules() {
  const { schedules } = await chrome.storage.local.get("schedules");
  return schedules ?? DEFAULT_STORAGE.schedules;
}

async function setSchedules(schedules) {
  await chrome.storage.local.set({ schedules });
}

async function addSchedule(schedule) {
  const schedules = await getSchedules();
  schedules.push(schedule);
  await setSchedules(schedules);
}

async function removeSchedule(id) {
  const schedules = await getSchedules();
  await setSchedules(schedules.filter(s => s.id !== id));
}

async function updateSchedule(id, updates) {
  const schedules = await getSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx !== -1) {
    schedules[idx] = { ...schedules[idx], ...updates };
    await setSchedules(schedules);
  }
}

// =========================================================================
// Session history
// =========================================================================

const MAX_HISTORY_ENTRIES = 200;

async function getSessionHistory() {
  const { sessionHistory } = await chrome.storage.local.get("sessionHistory");
  return sessionHistory ?? DEFAULT_STORAGE.sessionHistory;
}

async function recordSession(record) {
  const history = await getSessionHistory();
  history.push(record);
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }
  await chrome.storage.local.set({ sessionHistory: history });
}

// =========================================================================
// Stats
// =========================================================================

async function getStats() {
  const { stats } = await chrome.storage.local.get("stats");
  return stats ?? DEFAULT_STORAGE.stats;
}

/** Returns "YYYY-MM-DD" in local timezone. */
function getLocalDateString(date) {
  return date.toLocaleDateString("sv");
}

async function updateStatsAfterSession(actualMinutes) {
  const stats = await getStats();
  stats.totalSessions += 1;
  stats.totalFocusMinutes += actualMinutes;

  const today = getLocalDateString(new Date());
  if (stats.lastSessionDate === today) {
    // Already logged a session today — streak unchanged
  } else {
    const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
    if (stats.lastSessionDate === yesterday) {
      stats.currentStreak += 1;
    } else {
      stats.currentStreak = 1;
    }
    stats.lastSessionDate = today;
  }

  await chrome.storage.local.set({ stats });
}
