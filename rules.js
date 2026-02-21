/**
 * rules.js — YouTube channel rule evaluation.
 *
 * Pure functions with no direct storage access.
 * Only called in precision mode — caller is responsible for mode gating.
 */

/**
 * Determine whether a YouTube channel should be blocked.
 * Allowlist always overrides blocklist. Case-insensitive.
 *
 * When blockAll is true, every channel is blocked by default
 * unless it appears in the allowedChannels list.
 *
 * @param {string|string[]} identifiers  UC-style IDs and/or handles.
 * @param {object|undefined} rules       blockRules.youtube object.
 * @param {boolean}          blockAll    Block all channels by default.
 * @returns {boolean}
 */
function shouldBlockYouTubeChannel(identifiers, rules, blockAll = false) {
  if (!rules) return blockAll;

  const ids = (Array.isArray(identifiers) ? identifiers : [identifiers])
    .map((id) => id.toLowerCase());

  const { blockedChannels = [], allowedChannels = [] } = rules;

  if (ids.some((id) => allowedChannels.some((c) => c.toLowerCase() === id))) return false;
  if (ids.some((id) => blockedChannels.some((c) => c.toLowerCase() === id))) return true;

  return blockAll;
}
