/**
 * rules.js — URL evaluation engine.
 *
 * Each function answers a single question: "should this URL be blocked?"
 * Whitelist entries always override blocklist entries so parents/teachers
 * can carve out exceptions.
 */

/**
 * Extract the channel handle or ID from a YouTube URL.
 * Supports /channel/UCXXX, /@handle, and /c/CustomName paths.
 * Returns null when the URL is not a channel-specific video page we can parse.
 */
function extractYouTubeChannel(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // /@handle
    const handleMatch = path.match(/^\/@([^/]+)/);
    if (handleMatch) return handleMatch[1].toLowerCase();

    // /channel/UCXXX
    const channelIdMatch = path.match(/^\/channel\/([^/]+)/);
    if (channelIdMatch) return channelIdMatch[1].toLowerCase();

    // /c/CustomName
    const customMatch = path.match(/^\/c\/([^/]+)/);
    if (customMatch) return customMatch[1].toLowerCase();

    return null;
  } catch {
    return null;
  }
}

/**
 * Determine if a YouTube URL should be blocked.
 * A channel is blocked when:
 *   1. It appears in blockedChannels AND
 *   2. It does NOT appear in allowedChannels (whitelist wins).
 *
 * `channelId` can optionally be supplied by the content script when it
 * reads the channel from the DOM (which is more reliable than URL parsing).
 */
async function isYouTubeVideoBlocked(videoUrl, channelId = null) {
  const rules = await getBlockRules();
  const { blockedChannels, allowedChannels } = rules.youtube;

  const channel = (channelId ?? extractYouTubeChannel(videoUrl) ?? "").toLowerCase();

  if (!channel) return false;

  const normalize = (list) => list.map((c) => c.toLowerCase());

  // Whitelist takes priority — never block an explicitly allowed channel.
  if (normalize(allowedChannels).includes(channel)) return false;

  return normalize(blockedChannels).includes(channel);
}

/**
 * Extract the subreddit name from a Reddit URL.
 * Handles /r/subreddit paths; returns null for the front page or non-sub pages.
 */
function extractSubreddit(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/r\/([^/]+)/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Determine if a Reddit URL should be blocked.
 *
 * Blocking strategy:
 *   • If the page is a subreddit that appears in allowedSubreddits → allow.
 *   • If the page is a subreddit that appears in blockedSubreddits → block.
 *   • If blockedSubreddits contains the wildcard "*" → block all except allowed.
 *   • Front page / non-subreddit pages follow the wildcard rule when set.
 */
async function isRedditPageBlocked(url) {
  const rules = await getBlockRules();
  const { blockedSubreddits, allowedSubreddits } = rules.reddit;

  const sub = extractSubreddit(url);

  const normalizeList = (list) => list.map((s) => s.toLowerCase());
  const allowed = normalizeList(allowedSubreddits);
  const blocked = normalizeList(blockedSubreddits);

  // Whitelist always wins.
  if (sub && allowed.includes(sub)) return false;

  // Explicit block.
  if (sub && blocked.includes(sub)) return true;

  // Wildcard: block everything on reddit except whitelisted subs.
  if (blocked.includes("*")) return true;

  return false;
}

/**
 * Check a URL against the generic blockedSites list.
 * Entries are matched against the hostname (e.g. "tiktok.com").
 */
async function isSiteBlocked(url) {
  try {
    const rules = await getBlockRules();
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return rules.blockedSites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

/**
 * Top-level gate: should this URL be blocked right now?
 * Blocking only applies when a focus session is active.
 */
async function shouldBlockUrl(url) {
  const focusActive = await isFocusActive();
  if (!focusActive) return false;

  if (url.includes("youtube.com")) return isYouTubeVideoBlocked(url);
  if (url.includes("reddit.com")) return isRedditPageBlocked(url);

  return isSiteBlocked(url);
}
