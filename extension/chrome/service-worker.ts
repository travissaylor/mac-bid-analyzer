// Chrome MV3 service worker.
//
// Responsibilities:
//   1. Proxy backend HTTP fetches from the content script (BACKEND_FETCH).
//      The page-context fetch on HTTPS mac.bid would be blocked by mixed-
//      content rules when the backend is plain HTTP, but the SW context is
//      not subject to that restriction.
//   2. Manage the toolbar action badge — set "LOT" green text when a lot
//      page is detected, clear it otherwise.
//
// All chrome.action.* calls are feature-guarded so that the same logic
// (once shared with the Safari port) does not crash on iOS where the
// action surface may be absent.

interface BackendFetchMessage {
  action: "BACKEND_FETCH";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

interface LotDetectedMessage {
  action: "LOT_DETECTED";
  lotInfo: unknown;
}

interface LotNotDetectedMessage {
  action: "LOT_NOT_DETECTED";
}

type IncomingMessage =
  | BackendFetchMessage
  | LotDetectedMessage
  | LotNotDetectedMessage
  | { action: string };

interface BackendFetchResult {
  ok?: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

const BADGE_COLOR_LOT = "#4CAF50";

async function performBackendFetch(
  msg: BackendFetchMessage
): Promise<BackendFetchResult> {
  try {
    const resp = await fetch(msg.url, {
      method: msg.method || "GET",
      headers: msg.headers || {},
      body: msg.body ?? undefined,
    });
    const text = await resp.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { ok: resp.ok, status: resp.status, body: parsed };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network error";
    return { error: message || "Network error" };
  }
}

chrome.runtime.onMessage.addListener(
  (message: IncomingMessage, sender, sendResponse) => {
    if (message.action === "BACKEND_FETCH") {
      performBackendFetch(message as BackendFetchMessage)
        .then(sendResponse)
        .catch((err: unknown) => {
          const m = err instanceof Error ? err.message : "Network error";
          sendResponse({ error: m || "Network error" });
        });
      return true;
    }

    const tabId = sender.tab?.id;
    if (tabId === undefined) return;

    if (message.action === "LOT_DETECTED") {
      chrome.action?.setBadgeBackgroundColor?.({
        tabId,
        color: BADGE_COLOR_LOT,
      });
      chrome.action?.setBadgeText?.({ tabId, text: "LOT" });
    } else if (message.action === "LOT_NOT_DETECTED") {
      chrome.action?.setBadgeText?.({ tabId, text: "" });
    }
  }
);

// Clear the badge when navigating away from mac.bid in any tab.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !changeInfo.url.includes("mac.bid")) {
    chrome.action?.setBadgeText?.({ tabId, text: "" });
  }
});
