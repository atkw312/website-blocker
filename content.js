/**
 * content.js — Focus Blocker content script.
 *
 * Handles YouTube channel-based video blocking with full SPA support,
 * and Reddit subreddit blocking via the background service worker.
 */

(() => {
  "use strict";

  if (window.__focusBlockerInjected) return;
  window.__focusBlockerInjected = true;

  const POLL_INTERVAL_MS = 2000;
  const SPA_NAV_DELAY_MS = 500;

  let blocked = false;
  let lastCheckedUrl = null;
  let lastCheckedChannelId = null;

  // =========================================================================
  // YouTube — Channel ID extraction
  // =========================================================================

  /**
   * Collect all available identifiers for the currently viewed video's channel.
   * Returns an array (e.g. ["UCBcRF18a7Qf58cCRy5xuWwQ", "mkbhd"]) so that
   * shouldBlockChannel() can match against handles *and* UC-style IDs.
   * Returns null if no identifiers could be found yet.
   */
  function getYouTubeChannelIdentifiers() {
    const ids = new Set();

    // Method 1 (primary): <meta itemprop="channelId"> — inserted by YouTube
    // on every /watch, /shorts, /live page.  Fastest DOM read.
    try {
      const meta = document.querySelector('meta[itemprop="channelId"]');
      if (meta?.content) ids.add(meta.content);
    } catch { /* element missing or access error */ }

    // Method 2: ytInitialPlayerResponse is a global YouTube injects before
    // hydration.  Available early, even before the meta tag in some cases.
    try {
      const playerResponse = window.ytInitialPlayerResponse;
      if (playerResponse?.videoDetails?.channelId) {
        ids.add(playerResponse.videoDetails.channelId);
      }
    } catch { /* variable not present */ }

    // Method 3 (fallback): The channel name link rendered inside the
    // video's metadata section.  Only available after the page fully renders.
    try {
      const link = document.querySelector("ytd-channel-name a");
      if (link?.href) {
        const channelMatch = link.href.match(/\/channel\/([^/?#]+)/);
        if (channelMatch) ids.add(channelMatch[1]);

        const handleMatch = link.href.match(/\/@([^/?#]+)/);
        if (handleMatch) ids.add(handleMatch[1]);
      }
    } catch { /* element missing */ }

    return ids.size > 0 ? [...ids] : null;
  }

  // =========================================================================
  // Storage helpers — direct chrome.storage.local reads
  // =========================================================================

  /** Check whether a focus session is currently active. */
  async function isFocusActive() {
    try {
      const { focusSession } = await chrome.storage.local.get("focusSession");
      if (!focusSession?.active) return false;

      // Auto-expire elapsed sessions.
      if (focusSession.endTime && Date.now() >= focusSession.endTime) {
        await chrome.storage.local.set({
          focusSession: { active: false, startTime: null, endTime: null, locked: false }
        });
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decide whether a channel (identified by one or more IDs/handles) should
   * be blocked.  Whitelist (allowedChannels) always overrides blocklist.
   * @param {string[]} identifiers — array of UC IDs and/or handles
   */
  async function shouldBlockChannel(identifiers) {
    try {
      const { blockRules } = await chrome.storage.local.get("blockRules");
      if (!blockRules?.youtube) return false;

      const { blockedChannels = [], allowedChannels = [] } = blockRules.youtube;
      const lowerIds = identifiers.map((id) => id.toLowerCase());

      if (lowerIds.some((id) => allowedChannels.some((c) => c.toLowerCase() === id))) return false;
      if (lowerIds.some((id) => blockedChannels.some((c) => c.toLowerCase() === id))) return true;

      return false;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // Blocking UI
  // =========================================================================

  /** Nuke the page: stop all media, replace content with block message. */
  function blockPage() {
    if (blocked) return;
    blocked = true;

    // Kill every video and audio element to halt playback immediately.
    document.querySelectorAll("video, audio").forEach((el) => {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch { /* best effort */ }
    });

    // Wipe the body and show the block message.
    document.body.innerHTML = "";
    document.body.style.cssText = [
      "margin:0",
      "height:100vh",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "flex-direction:column",
      "background:#1a1a2e",
      "color:#e0e0e0",
      "font-family:system-ui,sans-serif",
      "text-align:center",
      "padding:2rem"
    ].join(";");

    const msg = document.createElement("div");
    msg.id = "focus-blocker-blocked";
    msg.innerHTML =
      '<h1 style="font-size:2rem;margin:0 0 0.5rem">Focus Session Active</h1>' +
      '<p style="font-size:1.25rem;opacity:0.8;margin:0">This video is blocked.</p>';
    document.body.appendChild(msg);
  }

  // =========================================================================
  // Reddit — overlay-based blocking (delegates decision to background)
  // =========================================================================

  function showRedditOverlay() {
    if (document.getElementById("focus-blocker-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "focus-blocker-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      background: "#1a1a2e",
      color: "#e0e0e0",
      fontFamily: "system-ui, sans-serif",
      fontSize: "1.5rem",
      textAlign: "center",
      padding: "2rem"
    });
    overlay.innerHTML =
      '<h1 style="font-size:2rem;margin-bottom:0.5rem">Focus Session Active</h1>' +
      "<p>This site is blocked during your focus session.</p>";
    document.documentElement.appendChild(overlay);
  }

  function removeRedditOverlay() {
    const el = document.getElementById("focus-blocker-overlay");
    if (el) el.remove();
  }

  // =========================================================================
  // Core check logic
  // =========================================================================

  /** Return true if the current URL is a YouTube video-like page. */
  function isYouTubeVideoPage(url) {
    return /youtube\.com\/(watch|shorts|live|embed)/.test(url);
  }

  /** Main evaluation: decide whether to block the current page. */
  async function checkAndBlock() {
    const url = window.location.href;

    // ------ YouTube ------
    if (url.includes("youtube.com")) {
      if (!isYouTubeVideoPage(url)) {
        // Not a video page — nothing to block.
        lastCheckedUrl = url;
        return;
      }

      if (!(await isFocusActive())) {
        lastCheckedUrl = url;
        return;
      }

      const identifiers = getYouTubeChannelIdentifiers();
      if (!identifiers) {
        // DOM hasn't populated yet — the poll timer will retry.
        return;
      }

      // Avoid redundant storage reads for the same video.
      const idKey = identifiers.join(",");
      if (url === lastCheckedUrl && idKey === lastCheckedChannelId && blocked) {
        return;
      }

      lastCheckedUrl = url;
      lastCheckedChannelId = idKey;

      if (await shouldBlockChannel(identifiers)) {
        blockPage();
      }
      return;
    }

    // ------ Reddit ------
    if (url.includes("reddit.com")) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CHECK_BLOCK",
          url,
          channelId: null
        });
        if (response?.blocked) {
          showRedditOverlay();
        } else {
          removeRedditOverlay();
        }
      } catch { /* extension context invalidated */ }
      lastCheckedUrl = url;
    }
  }

  // =========================================================================
  // Initialisation & SPA navigation handling
  // =========================================================================

  function init() {
    // Run immediately on injection.
    checkAndBlock();

    // YouTube fires this custom event on every SPA navigation.
    document.addEventListener("yt-navigate-finish", () => {
      // Reset blocking state — YouTube rebuilds the DOM on navigation.
      blocked = false;
      lastCheckedChannelId = null;

      // Short delay so YouTube has time to populate meta tags.
      setTimeout(checkAndBlock, SPA_NAV_DELAY_MS);
    });

    // Polling fallback: catches slow-loading meta tags, edge cases where
    // yt-navigate-finish doesn't fire, and late focus-session activations.
    setInterval(() => {
      const url = window.location.href;
      if (url !== lastCheckedUrl || !blocked) {
        checkAndBlock();
      }
    }, POLL_INTERVAL_MS);
  }

  init();
})();
