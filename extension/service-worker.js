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
  } else if (message.action === "OPEN_SIDE_PANEL") {
    // Must be called synchronously in response to the user-gesture message
    // so Chrome preserves the activation.
    chrome.sidePanel.open({ tabId }).catch((err) => {
      console.error("sidePanel.open failed:", err);
    });
  }
});

// Clear badge when navigating away from mac.bid
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !changeInfo.url.includes("mac.bid")) {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
