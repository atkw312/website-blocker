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
    locked: false
  },
  settings: {
    strictMode: false,
    requireParentUnlock: false,
    parentPinHash: null,
    sessionDurationMinutes: 30
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
    await chrome.storage.local.set({
      focusSession: { active: false, startTime: null, endTime: null, locked: false }
    });
    return false;
  }

  return true;
}

/** Begin a new focus session lasting `durationMinutes`. */
async function startFocusSession(durationMinutes) {
  const settings = await getSettings();
  const now = Date.now();
  const session = {
    active: true,
    startTime: now,
    endTime: now + durationMinutes * 60 * 1000,
    locked: settings.requireParentUnlock && !!settings.parentPinHash
  };
  await chrome.storage.local.set({ focusSession: session });
  return session;
}

/**
 * Manually end the current focus session.
 * Returns true if ended successfully, false if the session is locked.
 * Pass { parentApproved: true } to override a lock (Phase 2 UI).
 */
async function endFocusSession({ parentApproved = false } = {}) {
  const session = await getActiveSession();
  if (!session.active) return true;
  if (session.locked && !parentApproved) return false;

  await chrome.storage.local.set({
    focusSession: { active: false, startTime: null, endTime: null, locked: false }
  });
  return true;
}
