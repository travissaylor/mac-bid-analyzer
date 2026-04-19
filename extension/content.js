// Content script for mac.bid pages
// Detects lot pages, extracts the lot identifier, and shows an inline
// analysis badge on individual lot views (lot detail + search preview).

const LOT_URL_PATTERNS = [
  // /auction/{auctionIdOrCode}/lot/{lotNumber}
  // auctionIdOrCode may be numeric (79197) or a human-readable code (WAB2604-19-A1)
  /\/auction\/([^/]+)\/lot\/([^/?#\s]+)/,
  // /lot/{lotId}
  /\/lot\/([^/?#\s]+)/,
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

// ---------- Inline badge (Shadow DOM) ----------

const BADGE_HOST_ID = "mac-bid-analyzer-badge-host";
let badgeShadow = null;
let currentLotInfo = null;
let inFlightAnalysis = false;

const BADGE_STYLES = `
  .card {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    background: #fff;
    color: #222;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    padding: 10px 12px;
    min-width: 210px;
    max-width: 280px;
  }
  .card.good-deal { border-color: #4CAF50; background: #f3faf4; }
  .card.over-max { border-color: #F44336; background: #fdf4f4; }
  .card.error { border-color: #ff9800; background: #fff8e1; }
  .title { font-weight: 600; font-size: 12px; color: #555; margin-bottom: 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .col { display: flex; flex-direction: column; }
  .label {
    color: #666;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .amount {
    font-weight: 700;
    font-size: 20px;
    color: #111;
    margin-top: 2px;
    line-height: 1.1;
  }
  .card.good-deal .amount { color: #2E7D32; }
  .card.over-max .amount { color: #C62828; }
  .hint { color: #666; font-size: 12px; line-height: 1.35; }
  .error-msg { color: #b71c1c; font-size: 12px; line-height: 1.35; }
  button {
    font-family: inherit;
    border: none;
    cursor: pointer;
    border-radius: 6px;
    font-size: 12px;
    padding: 6px 12px;
  }
  button.primary { background: #1976D2; color: #fff; }
  button.primary:hover { background: #1565C0; }
  button.secondary { background: #f0f0f0; color: #333; }
  button.secondary:hover { background: #e0e0e0; }
  button.secondary.small { margin-top: 8px; font-size: 11px; padding: 4px 8px; }
  button.icon {
    background: transparent;
    color: #1976D2;
    padding: 4px 6px;
    font-size: 16px;
    line-height: 1;
  }
  button.icon:hover { background: #e3f2fd; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ddd;
    border-top-color: #1976D2;
    border-radius: 50%;
    animation: mba-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .spinner-row { display: flex; align-items: center; gap: 8px; }
  @keyframes mba-spin { to { transform: rotate(360deg); } }
`;

function ensureBadge() {
  const existing = document.getElementById(BADGE_HOST_ID);
  if (existing && badgeShadow) return badgeShadow;

  const host = document.createElement("div");
  host.id = BADGE_HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    top: "80px",
    right: "16px",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(host);

  badgeShadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BADGE_STYLES;
  const card = document.createElement("div");
  card.id = "card";
  card.className = "card";
  badgeShadow.appendChild(style);
  badgeShadow.appendChild(card);
  badgeShadow.addEventListener("click", handleBadgeClick);
  return badgeShadow;
}

function removeBadge() {
  document.getElementById(BADGE_HOST_ID)?.remove();
  badgeShadow = null;
}

function setCard(variant, html) {
  const shadow = ensureBadge();
  const card = shadow.getElementById("card");
  card.className = `card ${variant || ""}`.trim();
  card.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function renderChecking() {
  setCard("", `<div class="spinner-row"><div class="spinner"></div><span class="hint">Checking analysis…</span></div>`);
}

function renderAnalyzing() {
  setCard("", `<div class="spinner-row"><div class="spinner"></div><span class="hint">Analyzing lot…</span></div>`);
}

function renderNotAnalyzed() {
  setCard("", `
    <div class="title">mac.bid Analyzer</div>
    <button class="primary" data-action="analyze">Analyze now</button>
  `);
}

function renderAnalyzed(data) {
  const maxBid = data.recommended_max_bid;
  const currentBid = Number(data.current_bid) || 0;
  let valueHtml;
  let variant = "";
  if (maxBid === null || maxBid === undefined) {
    valueHtml = `<span class="amount">N/A</span>`;
  } else if (Number(maxBid) <= 0) {
    valueHtml = `<span class="amount">Not worth it</span>`;
    variant = "over-max";
  } else {
    const formatted = `$${Number(maxBid).toFixed(2)}`;
    valueHtml = `<span class="amount">${formatted}</span>`;
    variant = currentBid <= Number(maxBid) ? "good-deal" : "over-max";
  }
  setCard(variant, `
    <div class="row">
      <div class="col">
        <div class="label">Recommended max bid</div>
        ${valueHtml}
      </div>
      <button class="icon" data-action="details" title="Open full analysis in side panel">&#8505;</button>
    </div>
    <button class="secondary small" data-action="reanalyze">Re-analyze</button>
  `);
}

function renderError(message) {
  setCard("error", `
    <div class="error-msg">${escapeHtml(message)}</div>
    <button class="secondary small" data-action="analyze">Retry</button>
  `);
}

function renderNoToken() {
  setCard("", `
    <div class="title">mac.bid Analyzer</div>
    <div class="hint">Set an API token in the extension options (right-click the extension icon &rarr; Options).</div>
  `);
}

function handleBadgeClick(event) {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "analyze") startAnalysis(false);
  else if (action === "reanalyze") startAnalysis(true);
  else if (action === "details") openSidePanel();
}

// ---------- Settings + API ----------

async function getSettings() {
  const defaults = { backendUrl: "http://localhost:3000", apiToken: "" };
  try {
    const stored = await chrome.storage.sync.get(["backendUrl", "apiToken"]);
    return {
      backendUrl: stored.backendUrl || defaults.backendUrl,
      apiToken: stored.apiToken || defaults.apiToken,
    };
  } catch {
    return defaults;
  }
}

function noTokenError() {
  const err = new Error("API token not configured");
  err.code = "NO_TOKEN";
  return err;
}

async function fetchCached(lotInfo) {
  const { backendUrl, apiToken } = await getSettings();
  if (!apiToken) throw noTokenError();

  // The URL's lot identifier is the lot_number (e.g. "3173X"), not the
  // numeric internal lot_id. The URL's auction segment may be a numeric ID
  // (79197) or a human-readable code (WAB2604-19-A1) that we don't store.
  // Look up by lot_number; include auction_id only when it's numeric.
  let url;
  const lotNumber = lotInfo.lotNumber || lotInfo.lotId;
  if (lotNumber) {
    const params = new URLSearchParams({ lot_number: String(lotNumber) });
    if (lotInfo.auctionId && /^\d+$/.test(String(lotInfo.auctionId))) {
      params.set("auction_id", String(lotInfo.auctionId));
    }
    url = `${backendUrl}/api/lot?${params.toString()}`;
  } else if (/^\d+$/.test(String(lotInfo.lotId))) {
    url = `${backendUrl}/api/lot/${lotInfo.lotId}`;
  } else {
    return null;
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (resp.status === 404) return null;
  if (resp.status === 401) throw new Error("Invalid API token");
  if (!resp.ok) throw new Error(`Backend error (${resp.status})`);
  return await resp.json();
}

async function postAnalyze(lotInfo, force) {
  const { backendUrl, apiToken } = await getSettings();
  if (!apiToken) throw noTokenError();
  const body = { input: lotInfo.path || String(lotInfo.lotId) };
  if (force) body.force = true;
  const resp = await fetch(`${backendUrl}/api/analyze`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (resp.status === 401) throw new Error("Invalid API token");
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Backend error (${resp.status})`);
  }
  return await resp.json();
}

// ---------- Flow ----------

async function checkAndRender() {
  if (!currentLotInfo) return;
  const lotId = currentLotInfo.lotId;
  const lotInfo = currentLotInfo;
  renderChecking();
  try {
    const cached = await fetchCached(lotInfo);
    if (currentLotInfo?.lotId !== lotId) return;
    if (cached) renderAnalyzed(cached);
    else renderNotAnalyzed();
  } catch (err) {
    if (currentLotInfo?.lotId !== lotId) return;
    if (err.code === "NO_TOKEN") renderNoToken();
    else renderError(err.message || "Failed to check analysis");
  }
}

async function startAnalysis(force) {
  if (!currentLotInfo || inFlightAnalysis) return;
  inFlightAnalysis = true;
  const lotId = currentLotInfo.lotId;
  renderAnalyzing();
  try {
    const data = await postAnalyze(currentLotInfo, force);
    if (currentLotInfo?.lotId !== lotId) return;
    renderAnalyzed(data);
  } catch (err) {
    if (currentLotInfo?.lotId !== lotId) return;
    if (err.code === "NO_TOKEN") renderNoToken();
    else renderError(err.message || "Analysis failed");
  } finally {
    inFlightAnalysis = false;
  }
}

function openSidePanel() {
  chrome.runtime.sendMessage({ action: "OPEN_SIDE_PANEL" });
}

function handleLotForBadge(lotInfo) {
  const prev = currentLotInfo;
  currentLotInfo = lotInfo;
  if (!prev || prev.lotId !== lotInfo.lotId) {
    checkAndRender();
  }
}

function handleNoLotForBadge() {
  currentLotInfo = null;
  removeBadge();
}

// ---------- Detection + messaging ----------

function notifyLotStatus() {
  const lotInfo = extractLotInfo(window.location.href);

  if (lotInfo) {
    chrome.runtime.sendMessage({
      action: "LOT_DETECTED",
      lotInfo,
    });
    handleLotForBadge(lotInfo);
  } else {
    chrome.runtime.sendMessage({
      action: "LOT_NOT_DETECTED",
    });
    handleNoLotForBadge();
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
