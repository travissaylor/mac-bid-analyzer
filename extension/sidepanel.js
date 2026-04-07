// Side panel script
// Listens for lot detection messages to update the panel UI
// Checks for cached results and provides analyze/re-analyze buttons

const noLotMessage = document.getElementById("no-lot-message");
const lotInfoEl = document.getElementById("lot-info");
const lotIdentifierEl = document.getElementById("lot-identifier");
const actionsEl = document.getElementById("actions");
const loadingIndicator = document.getElementById("loading-indicator");
const errorMessageEl = document.getElementById("error-message");
const resultsEl = document.getElementById("results");
const resultsDataEl = document.getElementById("results-data");

let currentLotInfo = null;

/**
 * Read backend URL and API token from chrome.storage.sync, falling back to defaults.
 */
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

function showLoading(show) {
  loadingIndicator.style.display = show ? "block" : "none";
}

function showError(message) {
  if (message) {
    errorMessageEl.textContent = message;
    errorMessageEl.style.display = "block";
  } else {
    errorMessageEl.style.display = "none";
  }
}

function showResults(data) {
  resultsDataEl.textContent = JSON.stringify(data, null, 2);
  resultsEl.style.display = "block";
}

function hideResults() {
  resultsEl.style.display = "none";
  resultsDataEl.textContent = "";
}

function renderAnalyzeButton() {
  actionsEl.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Analyze";
  btn.addEventListener("click", () => runAnalysis(false));
  actionsEl.appendChild(btn);
}

function renderReanalyzeButton() {
  actionsEl.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-secondary";
  btn.textContent = "Re-analyze";
  btn.addEventListener("click", () => runAnalysis(true));
  actionsEl.appendChild(btn);
}

function disableActions() {
  const buttons = actionsEl.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
}

function enableActions() {
  const buttons = actionsEl.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = false));
}

/**
 * Check for cached results via GET /api/lot/:lotId
 */
async function checkCachedResults(lotId) {
  const { backendUrl, apiToken } = await getSettings();
  const url = `${backendUrl}/api/lot/${lotId}`;
  const headers = {};
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }

  const response = await fetch(url, { headers });
  if (response.ok) {
    return await response.json();
  }
  // 404 means not cached; other errors we ignore for cache check
  return null;
}

/**
 * Run analysis via POST /api/analyze
 */
async function callAnalyze(lotId, force) {
  const { backendUrl, apiToken } = await getSettings();
  const url = `${backendUrl}/api/analyze`;
  const headers = { "Content-Type": "application/json" };
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: String(lotId), force }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return await response.json();
}

/**
 * Main analysis flow: show loading, call API, display results or error.
 */
async function runAnalysis(force) {
  if (!currentLotInfo) return;

  showError(null);
  hideResults();
  showLoading(true);
  disableActions();

  try {
    const data = await callAnalyze(currentLotInfo.lotId, force);
    showResults(data);
    renderReanalyzeButton();
  } catch (err) {
    showError(err.message || "Analysis failed");
    renderAnalyzeButton();
  } finally {
    showLoading(false);
    enableActions();
  }
}

/**
 * Handle a detected lot: show identifier, check cache, render appropriate button.
 */
async function handleLotDetected(lotInfo) {
  currentLotInfo = lotInfo;

  noLotMessage.style.display = "none";
  lotInfoEl.style.display = "block";

  lotIdentifierEl.textContent = `Lot #${lotInfo.lotId}`;
  showError(null);
  hideResults();
  showLoading(true);
  actionsEl.innerHTML = "";

  // Check for cached results first (FR-8)
  try {
    const cached = await checkCachedResults(lotInfo.lotId);
    if (cached) {
      showResults(cached);
      renderReanalyzeButton();
    } else {
      renderAnalyzeButton();
    }
  } catch {
    // If cache check fails (e.g. network error), just show analyze button
    renderAnalyzeButton();
  } finally {
    showLoading(false);
  }
}

function handleLotNotDetected() {
  currentLotInfo = null;
  noLotMessage.style.display = "block";
  lotInfoEl.style.display = "none";
  showError(null);
  hideResults();
  actionsEl.innerHTML = "";
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "LOT_DETECTED") {
    handleLotDetected(message.lotInfo);
  } else if (message.action === "LOT_NOT_DETECTED") {
    handleLotNotDetected();
  }
});
