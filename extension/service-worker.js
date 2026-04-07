// Background service worker
// Listens for lot detection messages and manages badge state

const BADGE_COLORS = {
  lot: "#4CAF50", // green when on a lot page
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  const tabId = sender.tab.id;

  if (message.action === "LOT_DETECTED") {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS.lot });
    chrome.action.setBadgeText({ tabId, text: "LOT" });
  } else if (message.action === "LOT_NOT_DETECTED") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

// Clear badge when navigating away from mac.bid
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !changeInfo.url.includes("mac.bid")) {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
