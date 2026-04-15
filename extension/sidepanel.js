// Side panel script
// Listens for lot detection messages to update the panel UI
// Displays formatted analysis results from the backend API

const noLotMessage = document.getElementById("no-lot-message");
const lotInfoEl = document.getElementById("lot-info");
const lotIdentifierEl = document.getElementById("lot-identifier");
const actionsEl = document.getElementById("actions");
const loadingIndicator = document.getElementById("loading-indicator");
const errorMessageEl = document.getElementById("error-message");
const resultsEl = document.getElementById("results");
const resultsDataEl = document.getElementById("results-data");
const feedbackSectionEl = document.getElementById("feedback-section");
const feedbackTextareaEl = document.getElementById("feedback-textarea");
const feedbackSubmitBtn = document.getElementById("feedback-submit");

let currentLotInfo = null;

// --- Formatting helpers ---

function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function severityLabel(severity) {
  switch (severity) {
    case "high": return "HIGH";
    case "medium": return "MED";
    case "low": return "LOW";
    default: return severity;
  }
}

function severityClass(severity) {
  switch (severity) {
    case "high": return "severity-high";
    case "medium": return "severity-medium";
    case "low": return "severity-low";
    default: return "";
  }
}

function parseJsonField(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function parseComparables(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Transform raw AnalyzedItem from the API into display-friendly data.
 * Mirrors resolveDisplayData() from src/format.ts.
 */
function resolveDisplayData(item) {
  const ebay = item.ebay_sold_count > 0
    ? {
        median: item.ebay_sold_median,
        low: item.ebay_sold_low,
        high: item.ebay_sold_high,
        count: item.ebay_sold_count,
        searchQuery: item.ebay_search_query,
      }
    : null;

  const ai = item.llm_provider && item.llm_estimate_mid !== null
    ? {
        provider: item.llm_provider,
        low: item.llm_estimate_low,
        mid: item.llm_estimate_mid,
        high: item.llm_estimate_high,
        confidence: item.llm_confidence,
        reasoning: item.llm_reasoning,
        comparables: parseComparables(item.llm_comparables),
      }
    : null;

  let maxBid;
  if (item.recommended_max_bid === null) {
    maxBid = { type: "unavailable" };
  } else if (item.recommended_max_bid <= 0) {
    maxBid = { type: "not_worth_it", amount: item.recommended_max_bid };
  } else {
    maxBid = { type: "value", amount: item.recommended_max_bid };
  }

  const hasPositiveMax = item.recommended_max_bid !== null && item.recommended_max_bid > 0;
  const isDeal = hasPositiveMax && item.current_bid <= item.recommended_max_bid;
  const isOverMax = hasPositiveMax && item.current_bid > item.recommended_max_bid;

  const manualReview = item.needs_manual_review
    ? { reason: item.manual_review_reason || "Unknown reason" }
    : null;

  const dealScore = item.deal_score !== null && item.deal_score !== undefined
    ? Math.round(item.deal_score)
    : null;

  const imageFlags = parseJsonField(item.image_flags);
  const imageRiskScore = item.image_risk_score;
  const imageAnalysisSkipped = item.image_analysis_skipped === 1;

  return {
    lotId: item.lot_id,
    productName: item.product_name,
    condition: item.condition,
    currentBid: item.current_bid,
    totalBids: item.total_bids,
    auctionLocation: item.auction_location || "",
    locationTier: item.location_tier || "",
    locationCost: item.location_cost,
    analysisSource: item.analysis_source,
    ebay,
    ai,
    maxBid,
    dealScore,
    salesTaxRate: item.sales_tax_rate,
    manualReview,
    isDeal,
    isOverMax,
    imageFlags,
    imageRiskScore,
    imageAnalysisSkipped,
    userFeedback: item.user_feedback || null,
  };
}

/**
 * Render formatted analysis results into the results container.
 */
function renderResults(data) {
  const html = [];

  // Header: product name and meta
  html.push(`<div class="analysis-header">`);
  const correctedPill = data.userFeedback !== null ? `<span class="pill">Corrected</span>` : "";
  html.push(`<div class="product-name">${escapeHtml(data.productName)}${correctedPill}</div>`);
  html.push(`<div class="lot-meta">Lot #${data.lotId} &middot; ${escapeHtml(data.condition)} &middot; ${escapeHtml(data.auctionLocation || "Unknown")} (${escapeHtml(data.locationTier || "unknown")} tier)</div>`);
  html.push(`</div>`);

  // Max bid banner
  let bannerClass = "neutral";
  let bidDisplay = "";
  let dealInfo = "";
  if (data.maxBid.type === "value") {
    bidDisplay = formatCurrency(data.maxBid.amount);
    if (data.isDeal) {
      bannerClass = "good-deal";
    } else if (data.isOverMax) {
      bannerClass = "over-max";
    }
  } else if (data.maxBid.type === "not_worth_it") {
    bidDisplay = "NOT WORTH IT";
    bannerClass = "over-max";
  } else {
    bidDisplay = "N/A";
  }

  if (data.dealScore !== null) {
    dealInfo = `<div class="deal-score">Deal Score: ${data.dealScore}%</div>`;
  }

  html.push(`<div class="max-bid-banner ${bannerClass}">`);
  html.push(`<span class="label">Recommended Max Bid</span>`);
  html.push(`<span class="bid-value">${bidDisplay}</span>`);
  html.push(`<div class="row"><span>Current Bid: ${formatCurrency(data.currentBid)} (${data.totalBids} bids)</span></div>`);
  html.push(dealInfo);
  html.push(`</div>`);

  // Manual review warning
  if (data.manualReview) {
    html.push(`<div class="manual-review-warning">&#9888; MANUAL REVIEW: ${escapeHtml(data.manualReview.reason)}</div>`);
  }

  // eBay data section
  html.push(`<div class="section">`);
  html.push(`<div class="section-title">eBay Data</div>`);
  html.push(`<div class="section-body">`);
  if (data.ebay) {
    html.push(`<div class="price-range">`);
    html.push(`<div class="price-col"><div class="price-label">Low</div><div class="price-value">${formatCurrency(data.ebay.low)}</div></div>`);
    html.push(`<div class="price-col"><div class="price-label">Median</div><div class="price-value">${formatCurrency(data.ebay.median)}</div></div>`);
    html.push(`<div class="price-col"><div class="price-label">High</div><div class="price-value">${formatCurrency(data.ebay.high)}</div></div>`);
    html.push(`</div>`);
    html.push(`<div class="row"><span class="label">Comparables</span><span class="value">${data.ebay.count}</span></div>`);
    if (data.ebay.searchQuery) {
      html.push(`<div class="row"><span class="label">Search Query</span><span class="value">${escapeHtml(data.ebay.searchQuery)}</span></div>`);
    }
  } else {
    html.push(`<div style="color:#999;">No eBay comps found.</div>`);
  }
  html.push(`</div></div>`);

  // AI Analysis section
  html.push(`<div class="section">`);
  html.push(`<div class="section-title">AI Analysis</div>`);
  html.push(`<div class="section-body">`);
  if (data.ai) {
    html.push(`<div class="price-range">`);
    html.push(`<div class="price-col"><div class="price-label">Low</div><div class="price-value">${formatCurrency(data.ai.low)}</div></div>`);
    html.push(`<div class="price-col"><div class="price-label">Mid</div><div class="price-value">${formatCurrency(data.ai.mid)}</div></div>`);
    html.push(`<div class="price-col"><div class="price-label">High</div><div class="price-value">${formatCurrency(data.ai.high)}</div></div>`);
    html.push(`</div>`);
    if (data.ai.confidence !== null && data.ai.confidence !== undefined) {
      html.push(`<div class="row"><span class="label">Confidence</span><span class="value">${data.ai.confidence}/100</span></div>`);
    }
    if (data.ai.reasoning) {
      html.push(`<div class="reasoning-text">${escapeHtml(data.ai.reasoning)}</div>`);
    }
    if (data.ai.comparables && data.ai.comparables.length > 0) {
      html.push(`<div style="margin-top:6px;font-size:12px;font-weight:600;color:#666;">Comparables</div>`);
      for (const comp of data.ai.comparables) {
        html.push(`<div class="comparable-item"><span>${escapeHtml(comp.name)}</span><span>${formatCurrency(comp.estimatedPrice)}</span></div>`);
      }
    }
  } else {
    html.push(`<div style="color:#999;">No AI analysis available.</div>`);
  }
  html.push(`</div></div>`);

  // Image flags section (only if there are flags or analysis was skipped)
  if (data.imageFlags || data.imageAnalysisSkipped) {
    html.push(`<div class="section">`);
    html.push(`<div class="section-title">Image Flags</div>`);
    html.push(`<div class="section-body">`);
    if (data.imageFlags) {
      if (data.imageRiskScore !== null && data.imageRiskScore !== undefined) {
        html.push(`<div class="row"><span class="label">Risk Score</span><span class="value">${data.imageRiskScore}/100</span></div>`);
      }
      for (const flag of data.imageFlags) {
        html.push(`<div class="image-flag"><span class="severity-badge ${severityClass(flag.severity)}">${severityLabel(flag.severity)}</span><span>${escapeHtml(flag.description)}</span></div>`);
      }
    } else {
      html.push(`<div style="color:#999;">No product photos available.</div>`);
    }
    html.push(`</div></div>`);
  }

  // Cost breakdown section
  html.push(`<div class="section">`);
  html.push(`<div class="section-title">Cost Breakdown</div>`);
  html.push(`<div class="section-body">`);
  if (data.analysisSource === "ebay" && data.ebay) {
    html.push(`<div class="row"><span class="label">Base Estimate (eBay)</span><span class="value">${formatCurrency(data.ebay.median)}</span></div>`);
  } else if (data.analysisSource === "ai" && data.ai) {
    html.push(`<div class="row"><span class="label">Base Estimate (AI)</span><span class="value">${formatCurrency(data.ai.mid)}</span></div>`);
  }
  if (data.salesTaxRate !== null && data.salesTaxRate !== undefined) {
    html.push(`<div class="row"><span class="label">Sales Tax Rate</span><span class="value">${(data.salesTaxRate * 100).toFixed(1)}%</span></div>`);
  }
  html.push(`<div class="row"><span class="label">Location Cost</span><span class="value">${formatCurrency(data.locationCost)}</span></div>`);
  html.push(`</div></div>`);

  // Source footer
  html.push(`<div class="source-footer">Analysis source: ${escapeHtml(data.analysisSource)}</div>`);

  return html.join("");
}

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

function showError(message, options = {}) {
  if (message) {
    errorMessageEl.innerHTML = "";
    const text = document.createElement("div");
    text.textContent = message;
    errorMessageEl.appendChild(text);

    if (options.retryable) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "btn btn-primary";
      retryBtn.textContent = "Retry";
      retryBtn.style.marginTop = "8px";
      retryBtn.addEventListener("click", () => {
        showError(null);
        runAnalysis({ force: false });
      });
      errorMessageEl.appendChild(retryBtn);
    }

    errorMessageEl.style.display = "block";
  } else {
    errorMessageEl.style.display = "none";
  }
}

function showResults(data) {
  const displayData = resolveDisplayData(data);
  resultsDataEl.innerHTML = renderResults(displayData);
  resultsEl.style.display = "block";
  feedbackSectionEl.style.display = "block";

  // Populate the feedback textarea from the response so it persists
  // across navigation (GET /api/lot) and re-analysis (POST /api/analyze).
  if (displayData.userFeedback !== null && displayData.userFeedback !== undefined) {
    feedbackTextareaEl.value = displayData.userFeedback;
  } else {
    feedbackTextareaEl.value = "";
  }
}

function hideResults() {
  resultsEl.style.display = "none";
  resultsDataEl.innerHTML = "";
  feedbackSectionEl.style.display = "none";
}

function renderAnalyzeButton() {
  actionsEl.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Analyze";
  btn.addEventListener("click", () => runAnalysis({ force: false }));
  actionsEl.appendChild(btn);
}

function renderReanalyzeButton() {
  actionsEl.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-secondary";
  btn.textContent = "Re-analyze";
  btn.addEventListener("click", () => runAnalysis({ force: true }));
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

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (networkErr) {
    const err = new Error(`Cannot connect to backend at ${backendUrl}. Is the server running?`);
    err.isNetworkError = true;
    throw err;
  }

  if (response.status === 401) {
    throw new Error("Invalid API token. Check your extension settings.");
  }

  if (response.ok) {
    return await response.json();
  }
  // 404 means not cached; other errors we ignore for cache check
  return null;
}

/**
 * Run analysis via POST /api/analyze
 */
async function callAnalyze(lotId, options = {}) {
  const { backendUrl, apiToken } = await getSettings();
  const url = `${backendUrl}/api/analyze`;
  const headers = { "Content-Type": "application/json" };
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }

  const body = { input: currentLotInfo?.path || String(lotId) };
  if (options.force) {
    body.force = true;
  }
  if (Object.prototype.hasOwnProperty.call(options, "userFeedback")) {
    body.user_feedback = options.userFeedback;
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    const err = new Error(`Cannot connect to backend at ${backendUrl}. Is the server running?`);
    err.isNetworkError = true;
    throw err;
  }

  if (response.status === 401) {
    throw new Error("Invalid API token. Check your extension settings.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return await response.json();
}

/**
 * Main analysis flow: show loading, call API, display results or error.
 */
function disableFeedbackSubmit() {
  feedbackSubmitBtn.disabled = true;
}

function enableFeedbackSubmit() {
  feedbackSubmitBtn.disabled = false;
}

async function runAnalysis(options = {}) {
  if (!currentLotInfo) return;

  showError(null);
  hideResults();
  showLoading(true);
  disableActions();
  disableFeedbackSubmit();

  const { apiToken } = await getSettings();
  if (!apiToken) {
    showError("API token not configured. Please set it in the extension options (right-click the extension icon > Options).");
    showLoading(false);
    enableActions();
    enableFeedbackSubmit();
    return;
  }

  try {
    const data = await callAnalyze(currentLotInfo.lotId, options);
    showResults(data);
    renderReanalyzeButton();
  } catch (err) {
    showError(err.message || "Analysis failed", { retryable: !!err.isNetworkError });
    renderAnalyzeButton();
  } finally {
    showLoading(false);
    enableActions();
    enableFeedbackSubmit();
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
  feedbackTextareaEl.value = "";

  // Check for cached results first (FR-8)
  try {
    const cached = await checkCachedResults(lotInfo.lotId);
    if (cached) {
      showResults(cached);
      renderReanalyzeButton();
    } else {
      renderAnalyzeButton();
    }
  } catch (err) {
    showError(err.message || "Failed to connect to backend", { retryable: !!err.isNetworkError });
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
  feedbackTextareaEl.value = "";
}

feedbackSubmitBtn.addEventListener("click", () => {
  if (!currentLotInfo) return;
  runAnalysis({ userFeedback: feedbackTextareaEl.value });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "LOT_DETECTED") {
    handleLotDetected(message.lotInfo);
  } else if (message.action === "LOT_NOT_DETECTED") {
    handleLotNotDetected();
  }
});

// On panel open, proactively ask the active tab for its lot status.
// This handles the reopen scenario where the content script's initial
// LOT_DETECTED message was sent before the panel existed.
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_LOT_STATUS" });
      if (response?.lotInfo) {
        handleLotDetected(response.lotInfo);
      } else {
        handleLotNotDetected();
      }
    }
  } catch {
    // Content script may not be injected (non-mac.bid tab); ignore.
  }
})();
