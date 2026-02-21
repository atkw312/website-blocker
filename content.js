/**
 * content.js — YouTube precision blocker.
 *
 * Mode-aware dispatcher:
 *   off:       no blocking, clean up any UI
 *   strict:    full-page "YouTube is blocked system-wide" overlay
 *   precision: channel-level blocking (video overlay, card hiding)
 *
 * SPA-aware via yt-navigate-finish, MutationObserver, and polling fallback.
 */

(() => {
  "use strict";

  if (window.__focusBlockerInjected) return;
  window.__focusBlockerInjected = true;

  const POLL_INTERVAL_MS = 2000;
  const SPA_NAV_DELAY_MS = 500;
  const MUTATION_DEBOUNCE_MS = 300;

  let blocked = false;
  let strictOverlayShown = false;
  let lastCheckedUrl = null;
  let lastCheckedIdentifiers = null;
  let mutationTimer = null;

  const CARD_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-reel-item-renderer"
  ].join(", ");

  // =========================================================================
  // Channel identifier extraction
  // =========================================================================

  /**
   * Collect every available identifier for the current video page's channel.
   * Returns an array (e.g. ["UCBcRF18a7Qf58cCRy5xuWwQ", "mkbhd"]) or null
   * if the DOM hasn't populated yet.
   */
  function getVideoChannelIdentifiers() {
    const ids = new Set();

    try {
      const meta = document.querySelector('meta[itemprop="channelId"]');
      if (meta?.content) ids.add(meta.content);
    } catch { /* element missing or access error */ }

    try {
      const resp = window.ytInitialPlayerResponse;
      if (resp?.videoDetails?.channelId) ids.add(resp.videoDetails.channelId);
    } catch { /* variable not present */ }

    try {
      const link = document.querySelector("ytd-channel-name a");
      if (link?.href) {
        const cm = link.href.match(/\/channel\/([^/?#]+)/);
        if (cm) ids.add(cm[1]);
        const hm = link.href.match(/\/@([^/?#]+)/);
        if (hm) ids.add(hm[1]);
      }
    } catch { /* element missing */ }

    return ids.size > 0 ? [...ids] : null;
  }

  /** Extract a channel handle or ID from a video card element. */
  function getCardChannelId(card) {
    try {
      const link = card.querySelector("ytd-channel-name a");
      if (!link?.href) return null;

      const hm = link.href.match(/\/@([^/?#]+)/);
      if (hm) return hm[1];

      const cm = link.href.match(/\/channel\/([^/?#]+)/);
      if (cm) return cm[1];
    } catch { /* element missing */ }
    return null;
  }

  // =========================================================================
  // Blocking UI
  // =========================================================================

  /** Full-page overlay for precision mode — blocks a specific channel. */
  function showBlockOverlay() {
    if (blocked) return;
    blocked = true;

    document.querySelectorAll("video, audio").forEach((el) => {
      try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* best effort */ }
    });

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
      textAlign: "center",
      padding: "2rem"
    });
    overlay.innerHTML =
      '<h1 style="font-size:2rem;margin:0 0 0.5rem">Focus Session Active</h1>' +
      '<p style="font-size:1.25rem;opacity:0.8;margin:0">This channel is blocked during your focus session.</p>';
    document.documentElement.appendChild(overlay);
  }

  /** Full-page overlay for strict mode — YouTube is blocked system-wide. */
  function showStrictOverlay() {
    if (strictOverlayShown) return;
    strictOverlayShown = true;

    document.querySelectorAll("video, audio").forEach((el) => {
      try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* best effort */ }
    });

    // Remove precision overlay if present
    const existing = document.getElementById("focus-blocker-overlay");
    if (existing) existing.remove();
    blocked = false;

    const overlay = document.createElement("div");
    overlay.id = "focus-blocker-strict-overlay";
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
      textAlign: "center",
      padding: "2rem"
    });
    overlay.innerHTML =
      '<h1 style="font-size:2rem;margin:0 0 0.5rem">YouTube is Blocked</h1>' +
      '<p style="font-size:1.25rem;opacity:0.8;margin:0">Strict mode is active. YouTube is blocked system-wide during your focus session.</p>';
    document.documentElement.appendChild(overlay);
  }

  function removeBlockOverlay() {
    blocked = false;
    const el = document.getElementById("focus-blocker-overlay");
    if (el) el.remove();
  }

  function removeStrictOverlay() {
    strictOverlayShown = false;
    const el = document.getElementById("focus-blocker-strict-overlay");
    if (el) el.remove();
  }

  function removeAllOverlays() {
    removeBlockOverlay();
    removeStrictOverlay();
  }

  /** Remove the hidden class from all previously-hidden cards. */
  function unhideAllCards() {
    document.querySelectorAll(".focus-blocker-hidden").forEach((el) => {
      el.classList.remove("focus-blocker-hidden");
    });
  }

  // =========================================================================
  // Page type helpers
  // =========================================================================

  function isVideoPage(url) {
    return /youtube\.com\/(watch|shorts|live|embed)/.test(url);
  }

  function isChannelPage(url) {
    return /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+)(\/|$|\?)/.test(url);
  }

  /** Extract channel identifier from a channel page URL. */
  function getChannelPageIdentifier() {
    const url = window.location.href;
    const handleMatch = url.match(/youtube\.com\/@([^/?#]+)/);
    if (handleMatch) return handleMatch[1];
    const idMatch = url.match(/youtube\.com\/channel\/([^/?#]+)/);
    if (idMatch) return idMatch[1];
    return null;
  }

  // =========================================================================
  // Core blocking logic — precision mode helpers
  // =========================================================================

  /** Evaluate and potentially block a channel page (precision mode). */
  async function checkChannelPage(blockRules, blockAll) {
    if (blocked) return;

    const identifier = getChannelPageIdentifier();
    if (!identifier) return;

    const url = window.location.href;
    if (url === lastCheckedUrl && identifier === lastCheckedIdentifiers) return;

    lastCheckedUrl = url;
    lastCheckedIdentifiers = identifier;

    if (shouldBlockYouTubeChannel(identifier, blockRules?.youtube, blockAll)) {
      showBlockOverlay();
    }
  }

  /** Evaluate and potentially block a video page (precision mode). */
  async function checkVideoPage(blockRules, blockAll) {
    if (blocked) return;

    const identifiers = getVideoChannelIdentifiers();
    if (!identifiers) return;

    const url = window.location.href;
    const idKey = identifiers.join(",");
    if (url === lastCheckedUrl && idKey === lastCheckedIdentifiers) return;

    lastCheckedUrl = url;
    lastCheckedIdentifiers = idKey;

    if (shouldBlockYouTubeChannel(identifiers, blockRules?.youtube, blockAll)) {
      showBlockOverlay();
    }
  }

  /** Hide individual video cards from blocked channels on feed/search pages (precision mode). */
  async function filterFeedCards(blockRules, blockAll) {
    document.querySelectorAll(CARD_SELECTORS).forEach((card) => {
      const channelId = getCardChannelId(card);
      if (!channelId) return;

      if (shouldBlockYouTubeChannel(channelId, blockRules?.youtube, blockAll)) {
        card.classList.add("focus-blocker-hidden");
      } else {
        card.classList.remove("focus-blocker-hidden");
      }
    });
  }

  // =========================================================================
  // Top-level dispatcher — three-way mode dispatch
  // =========================================================================

  async function checkAndBlock() {
    const url = window.location.href;
    if (!url.includes("youtube.com")) return;

    const { focusSession, settings, blockRules } = await chrome.storage.local.get([
      "focusSession",
      "settings",
      "blockRules"
    ]);

    const mode = focusSession?.mode ?? "off";

    // --- OFF: clean up any blocking UI ---
    if (mode === "off") {
      removeAllOverlays();
      unhideAllCards();
      lastCheckedUrl = url;
      return;
    }

    // --- STRICT: show system-wide overlay on all pages ---
    if (mode === "strict") {
      removeBlockOverlay(); // remove precision overlay if switching
      unhideAllCards();
      showStrictOverlay();
      return;
    }

    // --- PRECISION: channel-level blocking ---
    removeStrictOverlay(); // remove strict overlay if switching
    const blockAll = settings?.blockAllChannels ?? false;

    if (isVideoPage(url)) {
      await checkVideoPage(blockRules, blockAll);
    } else if (isChannelPage(url)) {
      await checkChannelPage(blockRules, blockAll);
      await filterFeedCards(blockRules, blockAll);
    } else {
      await filterFeedCards(blockRules, blockAll);
    }
  }

  // =========================================================================
  // Initialization & navigation
  // =========================================================================

  function init() {
    // Inject styles for card hiding.
    const style = document.createElement("style");
    style.id = "focus-blocker-styles";
    style.textContent = ".focus-blocker-hidden { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);

    // Initial evaluation.
    checkAndBlock();

    // YouTube SPA navigation.
    document.addEventListener("yt-navigate-finish", () => {
      removeBlockOverlay();
      lastCheckedIdentifiers = null;
      setTimeout(checkAndBlock, SPA_NAV_DELAY_MS);
    });

    // MutationObserver: detect new content (infinite scroll, lazy metadata).
    const observer = new MutationObserver(() => {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(checkAndBlock, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    // Polling fallback.
    setInterval(() => {
      const url = window.location.href;
      if (url !== lastCheckedUrl || !blocked) {
        checkAndBlock();
      }
    }, POLL_INTERVAL_MS);
  }

  // Re-evaluate when block rules, session state, or settings change.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.blockRules || changes.focusSession || changes.settings) {
      lastCheckedUrl = null;
      lastCheckedIdentifiers = null;
      if (changes.blockRules && blocked) removeBlockOverlay();
      checkAndBlock();
    }
  });

  init();
})();
