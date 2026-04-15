// Content script for mac.bid pages
// Detects lot pages and extracts the lot identifier

const LOT_URL_PATTERNS = [
  // /auction/{auctionId}/lot/{lotNumber} (lot IDs can have letter suffixes like 2691L)
  /\/auction\/(\d+)\/lot\/(\d+[A-Za-z]*)/,
  // /lot/{lotId}
  /\/lot\/(\d+[A-Za-z]*)/,
];

function extractLotInfo(url) {
  const auctionLotMatch = url.match(LOT_URL_PATTERNS[0]);
  if (auctionLotMatch) {
    return {
      type: "auction_lot",
      auctionId: auctionLotMatch[1],
      lotNumber: auctionLotMatch[2],
      lotId: auctionLotMatch[2],
      path: new URL(url).pathname,
    };
  }

  const lotMatch = url.match(LOT_URL_PATTERNS[1]);
  if (lotMatch) {
    return {
      type: "lot",
      lotId: lotMatch[1],
      path: new URL(url).pathname,
    };
  }

  // /search?aid={auctionId}&lid={lotId} (preview panel)
  const parsed = new URL(url);
  if (parsed.pathname === "/search") {
    const aid = parsed.searchParams.get("aid");
    const lid = parsed.searchParams.get("lid");
    if (aid && lid) {
      return {
        type: "auction_lot",
        auctionId: aid,
        lotNumber: lid,
        lotId: lid,
        path: `/auction/${aid}/lot/${lid}`,
      };
    }
  }

  return null;
}

function notifyLotStatus() {
  const lotInfo = extractLotInfo(window.location.href);

  if (lotInfo) {
    chrome.runtime.sendMessage({
      action: "LOT_DETECTED",
      lotInfo,
    });
  } else {
    chrome.runtime.sendMessage({
      action: "LOT_NOT_DETECTED",
    });
  }
}

// Detect on initial page load
notifyLotStatus();

// Re-detect on URL changes (mac.bid may use client-side navigation)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    notifyLotStatus();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (back/forward navigation)
window.addEventListener("popstate", notifyLotStatus);

// Respond to status requests from the side panel (e.g. when it reopens
// after the initial LOT_DETECTED message was already sent).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "GET_LOT_STATUS") {
    const lotInfo = extractLotInfo(window.location.href);
    sendResponse({ lotInfo });
  }
});
