/**
 * rules.js — YouTube channel rule evaluation.
 *
 * Pure functions with no direct storage access.
 */

/**
 * Determine whether a YouTube channel should be blocked.
 * Allowlist always overrides blocklist. Case-insensitive.
 *
 * @param {string|string[]} identifiers  UC-style IDs and/or handles.
 * @param {object|undefined} rules       blockRules.youtube object.
 * @param {object|undefined} session     focusSession object.
 * @returns {boolean}
 */
function shouldBlockYouTubeChannel(identifiers, rules, session) {
  if (!session?.active) return false;
  if (!rules) return false;

  const ids = (Array.isArray(identifiers) ? identifiers : [identifiers])
    .map((id) => id.toLowerCase());

  const { blockedChannels = [], allowedChannels = [] } = rules;

  if (ids.some((id) => allowedChannels.some((c) => c.toLowerCase() === id))) return false;
  if (ids.some((id) => blockedChannels.some((c) => c.toLowerCase() === id))) return true;

  return false;
}
