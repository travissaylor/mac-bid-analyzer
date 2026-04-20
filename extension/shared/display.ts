// Pure formatting and rendering helpers. All output is HTML strings — no
// DOM manipulation, no document.* — so this module is safe to use in any
// JavaScript context (including the entry point, modal, etc.).

import type {
  AnalyzedItem,
  AiDisplay,
  Comparable,
  DisplayData,
  EbayDisplay,
  ImageFlag,
  MaxBidDisplay,
} from "./types";

export function formatCurrency(amount: number | null | undefined): string {
  return `$${Number(amount).toFixed(2)}`;
}

/**
 * HTML-escape arbitrary input. Implementation is DOM-free — uses a small
 * lookup table over the five characters that matter inside an HTML element
 * body or attribute value.
 */
export function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return "";
  const str = String(text);
  return str.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

export function severityLabel(severity: string): string {
  switch (severity) {
    case "high": return "HIGH";
    case "medium": return "MED";
    case "low": return "LOW";
    default: return severity;
  }
}

export function severityClass(severity: string): string {
  switch (severity) {
    case "high": return "severity-high";
    case "medium": return "severity-medium";
    case "low": return "severity-low";
    default: return "";
  }
}

/**
 * Parse a JSON-array string field. Returns null on parse error, missing
 * input, or empty array — callers branch on null to skip rendering.
 */
export function parseJsonField<T>(json: string | undefined | null): T[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/**
 * Parse the LLM comparables JSON string. Always returns an array (possibly
 * empty) — comparables are optional but never error-conditional.
 */
export function parseComparables(
  json: string | undefined | null
): Comparable[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Comparable[]) : [];
  } catch {
    return [];
  }
}

/**
 * Transform a raw `AnalyzedItem` from the API into display-friendly data.
 * Lifted from the original `sidepanel.js` (resolveDisplayData), which itself
 * mirrors `resolveDisplayData()` in `src/format.ts`.
 */
export function resolveDisplayData(item: AnalyzedItem): DisplayData {
  const ebay: EbayDisplay | null =
    item.ebay_sold_count > 0
      ? {
          median: item.ebay_sold_median,
          low: item.ebay_sold_low,
          high: item.ebay_sold_high,
          count: item.ebay_sold_count,
          searchQuery: item.ebay_search_query,
        }
      : null;

  const ai: AiDisplay | null =
    item.llm_provider && item.llm_estimate_mid !== null
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

  let maxBid: MaxBidDisplay;
  if (item.recommended_max_bid === null) {
    maxBid = { type: "unavailable" };
  } else if (item.recommended_max_bid <= 0) {
    maxBid = { type: "not_worth_it", amount: item.recommended_max_bid };
  } else {
    maxBid = { type: "value", amount: item.recommended_max_bid };
  }

  const hasPositiveMax =
    item.recommended_max_bid !== null && item.recommended_max_bid > 0;
  const isDeal =
    hasPositiveMax && item.current_bid <= (item.recommended_max_bid as number);
  const isOverMax =
    hasPositiveMax && item.current_bid > (item.recommended_max_bid as number);

  const manualReview = item.needs_manual_review
    ? { reason: item.manual_review_reason || "Unknown reason" }
    : null;

  const dealScore =
    item.deal_score !== null && item.deal_score !== undefined
      ? Math.round(item.deal_score)
      : null;

  const imageFlags = parseJsonField<ImageFlag>(item.image_flags);
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
 * Render the formatted analysis results body as an HTML string. The caller
 * is responsible for inserting this string into a parent container (the
 * modal in `modal.ts`, historically the side panel's `#results-data` div).
 */
export function renderResults(data: DisplayData): string {
  const html: string[] = [];

  // Header: product name and meta
  html.push(`<div class="analysis-header">`);
  const correctedPill =
    data.userFeedback !== null ? `<span class="pill">Corrected</span>` : "";
  html.push(
    `<div class="product-name">${escapeHtml(data.productName)}${correctedPill}</div>`
  );
  html.push(
    `<div class="lot-meta">Lot #${data.lotId} &middot; ${escapeHtml(
      data.condition
    )} &middot; ${escapeHtml(
      data.auctionLocation || "Unknown"
    )} (${escapeHtml(data.locationTier || "unknown")} tier)</div>`
  );
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
  html.push(
    `<div class="row"><span>Current Bid: ${formatCurrency(
      data.currentBid
    )} (${data.totalBids} bids)</span></div>`
  );
  html.push(dealInfo);
  html.push(`</div>`);

  // Manual review warning
  if (data.manualReview) {
    html.push(
      `<div class="manual-review-warning">&#9888; MANUAL REVIEW: ${escapeHtml(
        data.manualReview.reason
      )}</div>`
    );
  }

  // eBay data section
  html.push(`<div class="section">`);
  html.push(`<div class="section-title">eBay Data</div>`);
  html.push(`<div class="section-body">`);
  if (data.ebay) {
    html.push(`<div class="price-range">`);
    html.push(
      `<div class="price-col"><div class="price-label">Low</div><div class="price-value">${formatCurrency(
        data.ebay.low
      )}</div></div>`
    );
    html.push(
      `<div class="price-col"><div class="price-label">Median</div><div class="price-value">${formatCurrency(
        data.ebay.median
      )}</div></div>`
    );
    html.push(
      `<div class="price-col"><div class="price-label">High</div><div class="price-value">${formatCurrency(
        data.ebay.high
      )}</div></div>`
    );
    html.push(`</div>`);
    html.push(
      `<div class="row"><span class="label">Comparables</span><span class="value">${data.ebay.count}</span></div>`
    );
    if (data.ebay.searchQuery) {
      html.push(
        `<div class="row"><span class="label">Search Query</span><span class="value">${escapeHtml(
          data.ebay.searchQuery
        )}</span></div>`
      );
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
    html.push(
      `<div class="price-col"><div class="price-label">Low</div><div class="price-value">${formatCurrency(
        data.ai.low
      )}</div></div>`
    );
    html.push(
      `<div class="price-col"><div class="price-label">Mid</div><div class="price-value">${formatCurrency(
        data.ai.mid
      )}</div></div>`
    );
    html.push(
      `<div class="price-col"><div class="price-label">High</div><div class="price-value">${formatCurrency(
        data.ai.high
      )}</div></div>`
    );
    html.push(`</div>`);
    if (data.ai.confidence !== null && data.ai.confidence !== undefined) {
      html.push(
        `<div class="row"><span class="label">Confidence</span><span class="value">${data.ai.confidence}/100</span></div>`
      );
    }
    if (data.ai.reasoning) {
      html.push(
        `<div class="reasoning-text">${escapeHtml(data.ai.reasoning)}</div>`
      );
    }
    if (data.ai.comparables && data.ai.comparables.length > 0) {
      html.push(
        `<div style="margin-top:6px;font-size:12px;font-weight:600;color:#666;">Comparables</div>`
      );
      for (const comp of data.ai.comparables) {
        html.push(
          `<div class="comparable-item"><span>${escapeHtml(
            comp.name
          )}</span><span>${formatCurrency(comp.estimatedPrice)}</span></div>`
        );
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
        html.push(
          `<div class="row"><span class="label">Risk Score</span><span class="value">${data.imageRiskScore}/100</span></div>`
        );
      }
      for (const flag of data.imageFlags) {
        html.push(
          `<div class="image-flag"><span class="severity-badge ${severityClass(
            flag.severity
          )}">${severityLabel(flag.severity)}</span><span>${escapeHtml(
            flag.description
          )}</span></div>`
        );
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
    html.push(
      `<div class="row"><span class="label">Base Estimate (eBay)</span><span class="value">${formatCurrency(
        data.ebay.median
      )}</span></div>`
    );
  } else if (data.analysisSource === "ai" && data.ai) {
    html.push(
      `<div class="row"><span class="label">Base Estimate (AI)</span><span class="value">${formatCurrency(
        data.ai.mid
      )}</span></div>`
    );
  }
  if (data.salesTaxRate !== null && data.salesTaxRate !== undefined) {
    html.push(
      `<div class="row"><span class="label">Sales Tax Rate</span><span class="value">${(
        data.salesTaxRate * 100
      ).toFixed(1)}%</span></div>`
    );
  }
  html.push(
    `<div class="row"><span class="label">Location Cost</span><span class="value">${formatCurrency(
      data.locationCost
    )}</span></div>`
  );
  html.push(`</div></div>`);

  // Source footer
  html.push(
    `<div class="source-footer">Analysis source: ${escapeHtml(
      data.analysisSource
    )}</div>`
  );

  return html.join("");
}
