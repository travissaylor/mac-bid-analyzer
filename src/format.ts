import type { AnalyzedItem } from "./db";
import type { ImageFinding } from "./llm/image-prompt";

export interface ItemRenderer<T = string> {
  summary?(data: ItemDisplayData): T;
  detail?(data: ItemDisplayData): T;
  tableRow?(data: ItemDisplayData): T;
  table?(items: ItemDisplayData[]): T;
  activeOverview?(items: ItemDisplayData[]): T;
}

export interface Comparable {
  name: string;
  estimatedPrice: number;
}

export interface ItemDisplayData {
  // Identity
  lotId: number;
  productName: string;
  condition: string;
  currentBid: number;
  totalBids: number;
  isOpen: boolean;
  auctionLocation: string;
  locationTier: string;
  locationCost: number;
  analyzedAt: string;
  analysisSource: string;

  // eBay (null = no comps found)
  ebay: {
    median: number;
    low: number;
    high: number;
    count: number;
    searchQuery: string | null;
  } | null;

  // AI estimate (null = no AI data)
  ai: {
    provider: string;
    low: number;
    mid: number;
    high: number;
    confidence: number | null;
    reasoning: string | null;
    comparables: Comparable[];
  } | null;

  // Recommendation (discriminated union)
  maxBid:
    | { type: "value"; amount: number }
    | { type: "not_worth_it"; amount: number }
    | { type: "unavailable" };

  dealScore: number | null;
  salesTaxRate: number | null;

  // Flags
  manualReview: { reason: string } | null;
  isDeal: boolean;
  isOverMax: boolean;

  // Image analysis
  imageFlags: ImageFinding[] | null;
  imageRiskScore: number | null;
  imageAnalysisSkipped: boolean;

  // Auction timing
  expectedCloseDate: string | null;

  // Blended source info (for cost breakdown views)
  blend: { ebayMedian: number; aiMid: number } | null;
}

export function resolveDisplayData(item: AnalyzedItem): ItemDisplayData {
  // eBay comps gating
  const ebay =
    item.ebay_sold_count > 0
      ? {
          median: item.ebay_sold_median!,
          low: item.ebay_sold_low!,
          high: item.ebay_sold_high!,
          count: item.ebay_sold_count,
          searchQuery: item.ebay_search_query,
        }
      : null;

  // AI estimate gating
  const ai =
    item.llm_provider && item.llm_estimate_mid !== null
      ? {
          provider: item.llm_provider,
          low: item.llm_estimate_low!,
          mid: item.llm_estimate_mid,
          high: item.llm_estimate_high!,
          confidence: item.llm_confidence,
          reasoning: item.llm_reasoning,
          comparables: parseComparables(item.llm_comparables),
        }
      : null;

  // Max bid classification
  let maxBid: ItemDisplayData["maxBid"];
  if (item.recommended_max_bid === null) {
    maxBid = { type: "unavailable" };
  } else if (item.recommended_max_bid <= 0) {
    maxBid = { type: "not_worth_it", amount: item.recommended_max_bid };
  } else {
    maxBid = { type: "value", amount: item.recommended_max_bid };
  }

  // Deal flags
  const hasPositiveMax =
    item.recommended_max_bid !== null && item.recommended_max_bid > 0;
  const isDeal = hasPositiveMax && item.current_bid <= item.recommended_max_bid!;
  const isOverMax =
    hasPositiveMax && item.current_bid > item.recommended_max_bid!;

  // Manual review
  const manualReview = item.needs_manual_review
    ? { reason: item.manual_review_reason ?? "Unknown reason" }
    : null;

  // Deal score
  const dealScore =
    item.deal_score !== null ? Math.round(item.deal_score) : null;

  // Image flags
  const imageFlags = parseImageFlags(item.image_flags);
  const imageRiskScore = item.image_risk_score;
  const imageAnalysisSkipped = item.image_analysis_skipped === 1;

  // Blended source info
  const blend =
    item.analysis_source === "blended" &&
    item.ebay_sold_median !== null &&
    item.llm_estimate_mid !== null
      ? { ebayMedian: item.ebay_sold_median, aiMid: item.llm_estimate_mid }
      : null;

  return {
    lotId: item.lot_id,
    productName: item.product_name,
    condition: item.condition,
    currentBid: item.current_bid,
    totalBids: item.total_bids,
    isOpen: item.is_open === 1,
    auctionLocation: item.auction_location ?? "",
    locationTier: item.location_tier ?? "",
    locationCost: item.location_cost,
    analyzedAt: item.analyzed_at,
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
    expectedCloseDate: item.expected_close_date,
    blend,
  };
}

function parseComparables(json: string | null): Comparable[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function parseImageFlags(json: string | null): ImageFinding[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function formatImageFlagsSummary(flags: ImageFinding[]): string {
  return flags.map((f) => f.description).join(", ");
}

function severityLabel(severity: ImageFinding["severity"]): string {
  switch (severity) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
}

// --- Formatting helpers ---

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatMaxBid(maxBid: ItemDisplayData["maxBid"]): string {
  switch (maxBid.type) {
    case "value":
      return formatCurrency(maxBid.amount);
    case "not_worth_it":
      return "NOT WORTH IT";
    case "unavailable":
      return "N/A";
  }
}

function formatDealScore(score: number | null): string {
  return score !== null ? `${score}%` : "N/A";
}

// --- Plain text renderer ---

export const plainText: ItemRenderer<string> = {
  summary(data) {
    const lines: string[] = [];

    lines.push(data.productName);
    lines.push("");
    lines.push(`Lot: ${data.lotId}`);
    lines.push(`Condition: ${data.condition}`);
    lines.push(`Location: ${data.auctionLocation || "Unknown"} (${data.locationTier || "unknown"} tier)`);
    lines.push(`Current Bid: ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    if (data.ebay) {
      lines.push(`eBay Median: ${formatCurrency(data.ebay.median)} (${data.ebay.count} comps)`);
    } else {
      lines.push("eBay Comps: None found");
    }

    if (data.ai) {
      lines.push(`AI Estimate: ${formatCurrency(data.ai.mid)} (confidence: ${data.ai.confidence ?? "N/A"})`);
    }

    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: ${formatCurrency(data.maxBid.amount)} — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: ${formatMaxBid(data.maxBid)}`);
    }

    if (data.dealScore !== null) {
      lines.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }

    lines.push(`Source: ${data.analysisSource}`);

    if (data.imageFlags) {
      lines.push(`🔍 Image flags: ${formatImageFlagsSummary(data.imageFlags)}`);
    } else if (data.imageAnalysisSkipped) {
      lines.push("📷 No product photos available");
    }

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ MANUAL REVIEW: ${data.manualReview.reason}`);
    }

    return lines.join("\n");
  },

  detail(data) {
    const lines: string[] = [];

    lines.push(data.productName);
    lines.push("");
    lines.push(`Lot: ${data.lotId}`);
    lines.push(`Condition: ${data.condition}`);
    lines.push(`Location: ${data.auctionLocation || "Unknown"} (${data.locationTier || "unknown"} tier)`);
    lines.push(`Current Bid: ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    // eBay section
    lines.push("");
    lines.push("--- eBay Data ---");
    if (data.ebay) {
      lines.push(`Low: ${formatCurrency(data.ebay.low)} | Mid: ${formatCurrency(data.ebay.median)} | High: ${formatCurrency(data.ebay.high)}`);
      lines.push(`Comps: ${data.ebay.count}`);
    } else {
      lines.push("No eBay comps found.");
    }

    // AI section
    lines.push("");
    lines.push("--- AI Analysis ---");
    if (data.ai) {
      lines.push(`Low: ${formatCurrency(data.ai.low)} | Mid: ${formatCurrency(data.ai.mid)} | High: ${formatCurrency(data.ai.high)}`);
      if (data.ai.confidence !== null) {
        lines.push(`Confidence: ${data.ai.confidence}/100`);
      }
      if (data.ai.reasoning) {
        lines.push("");
        lines.push(`Reasoning: ${data.ai.reasoning}`);
      }
      if (data.ai.comparables.length > 0) {
        lines.push("");
        lines.push("Comparables:");
        for (const comp of data.ai.comparables) {
          lines.push(`  - ${comp.name}: ${formatCurrency(comp.estimatedPrice)}`);
        }
      }
    } else {
      lines.push("No AI analysis available.");
    }

    // Image flags section
    if (data.imageFlags) {
      lines.push("");
      lines.push("--- Image Flags ---");
      lines.push(`Risk Score: ${data.imageRiskScore ?? "N/A"}/100`);
      for (const flag of data.imageFlags) {
        lines.push(`  [${severityLabel(flag.severity)}] ${flag.description}`);
      }
    } else if (data.imageAnalysisSkipped) {
      lines.push("");
      lines.push("--- Image Flags ---");
      lines.push("No product photos available.");
    }

    // Cost breakdown
    lines.push("");
    lines.push("--- Cost Breakdown ---");
    if (data.blend) {
      lines.push(`Blended: eBay ${formatCurrency(data.blend.ebayMedian)} + AI ${formatCurrency(data.blend.aiMid)}`);
    } else if (data.analysisSource === "ebay-only" && data.ebay) {
      lines.push(`Base Estimate (eBay): ${formatCurrency(data.ebay.median)}`);
    } else if (data.analysisSource === "ai-only" && data.ai) {
      lines.push(`Base Estimate (AI): ${formatCurrency(data.ai.mid)}`);
    }
    if (data.salesTaxRate !== null) {
      lines.push(`Sales Tax Rate: ${(data.salesTaxRate * 100).toFixed(1)}%`);
    }
    lines.push(`Location Cost: ${formatCurrency(data.locationCost)}`);

    // Recommendation
    lines.push("");
    lines.push("--- Recommendation ---");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: ${formatCurrency(data.maxBid.amount)} — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: ${formatMaxBid(data.maxBid)}`);
    }
    if (data.dealScore !== null) {
      lines.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }
    lines.push(`Source: ${data.analysisSource}`);

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ MANUAL REVIEW: ${data.manualReview.reason}`);
    }

    return lines.join("\n");
  },

  tableRow(data) {
    const maxBidStr = formatMaxBid(data.maxBid);
    const scoreStr = formatDealScore(data.dealScore);
    const status = data.isOpen ? "OPEN" : "CLOSED";
    const review = data.manualReview ? " [REVIEW]" : "";
    const name = data.productName.length > 38
      ? data.productName.slice(0, 37) + "…"
      : data.productName;

    return [
      String(data.lotId).padEnd(10),
      name.padEnd(40),
      data.condition.padEnd(10),
      formatCurrency(data.currentBid).padEnd(8),
      maxBidStr.padEnd(10),
      scoreStr.padEnd(8),
      (status + review).padEnd(8),
    ].join(" ");
  },

  table(items) {
    const header = [
      "Lot ID".padEnd(10),
      "Product Name".padEnd(40),
      "Condition".padEnd(10),
      "Bid".padEnd(8),
      "Max Bid".padEnd(10),
      "Score".padEnd(8),
      "Status".padEnd(8),
    ].join(" ");

    const separator = "-".repeat(header.length);
    const rows = items.map((item) => plainText.tableRow!(item));

    return [header, separator, ...rows].join("\n");
  },

  activeOverview(items) {
    if (items.length === 0) {
      return "No active items.";
    }

    const sorted = [...items].sort((a, b) => {
      if (a.dealScore === null && b.dealScore === null) return 0;
      if (a.dealScore === null) return 1;
      if (b.dealScore === null) return -1;
      return b.dealScore - a.dealScore;
    });

    const deals = sorted.filter((i) => i.isDeal).length;

    const lines: string[] = [];
    lines.push(`${sorted.length} active item${sorted.length === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}`);

    for (const item of sorted) {
      lines.push("");
      lines.push(item.productName);
      lines.push(`Bid: ${formatCurrency(item.currentBid)}`);

      if (item.maxBid.type === "value") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        if (item.isOverMax) {
          lines.push("⛔ over max");
        } else if (item.dealScore !== null) {
          lines.push(`Deal: ${formatDealScore(item.dealScore)}`);
        }
      } else if (item.maxBid.type === "not_worth_it") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        lines.push("⛔ over max");
      } else {
        lines.push("Max: N/A");
      }
    }

    return lines.join("\n");
  },
};

// --- Telegram HTML renderer ---

export const telegramHtml: ItemRenderer<string> = {
  summary(data) {
    const lines: string[] = [];

    lines.push(`<b>${escapeHtml(data.productName)}</b>`);
    lines.push(`Lot: ${data.lotId} · ${escapeHtml(data.condition)}`);
    lines.push(`📍 ${escapeHtml(data.auctionLocation || "Unknown")} · ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);
    lines.push("");

    if (data.ebay) {
      lines.push(`📊 eBay: ${formatCurrency(data.ebay.median)} (${data.ebay.count} comps)`);
    } else {
      lines.push("📊 eBay: None found");
    }

    if (data.ai) {
      lines.push(`🤖 AI: ${formatCurrency(data.ai.mid)} (confidence: ${data.ai.confidence ?? "N/A"})`);
    }

    lines.push("");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`✅ Max Bid: <b>${formatCurrency(data.maxBid.amount)}</b> — NOT WORTH IT`);
    } else {
      lines.push(`✅ Max Bid: <b>${formatMaxBid(data.maxBid)}</b>`);
    }

    const metaParts: string[] = [];
    if (data.dealScore !== null) {
      metaParts.push(`Deal: ${formatDealScore(data.dealScore)}`);
    }
    metaParts.push(`Source: ${escapeHtml(data.analysisSource)}`);
    lines.push(metaParts.join(" · "));

    if (data.imageFlags) {
      lines.push(`🔍 Image flags: ${escapeHtml(formatImageFlagsSummary(data.imageFlags))}`);
    } else if (data.imageAnalysisSkipped) {
      lines.push("📷 No product photos available");
    }

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(data.manualReview.reason)}`);
    }

    return lines.join("\n");
  },

  detail(data) {
    const lines: string[] = [];

    lines.push(`<b>${escapeHtml(data.productName)}</b>`);
    lines.push(`Lot: ${data.lotId} · ${escapeHtml(data.condition)}`);
    lines.push(`📍 ${escapeHtml(data.auctionLocation || "Unknown")} · ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    // eBay section
    lines.push("");
    lines.push("📊 <b>eBay Data</b>");
    if (data.ebay) {
      lines.push(`${formatCurrency(data.ebay.low)} | ${formatCurrency(data.ebay.median)} | ${formatCurrency(data.ebay.high)}`);
      lines.push(`Comps: ${data.ebay.count}`);
    } else {
      lines.push("No eBay comps found.");
    }

    // AI section
    lines.push("");
    lines.push("🤖 <b>AI Analysis</b>");
    if (data.ai) {
      lines.push(`${formatCurrency(data.ai.low)} — ${formatCurrency(data.ai.mid)} — ${formatCurrency(data.ai.high)}`);
      if (data.ai.confidence !== null) {
        lines.push(`Confidence: ${data.ai.confidence}/100`);
      }
      if (data.ai.reasoning) {
        lines.push("");
        lines.push(`💬 ${escapeHtml(data.ai.reasoning)}`);
      }
      if (data.ai.comparables.length > 0) {
        lines.push("");
        lines.push("📋 <b>Comparables</b>");
        for (const comp of data.ai.comparables) {
          lines.push(`  • ${escapeHtml(comp.name)}: ${formatCurrency(comp.estimatedPrice)}`);
        }
      }
    } else {
      lines.push("No AI analysis available.");
    }

    // Image flags section
    if (data.imageFlags) {
      lines.push("");
      lines.push("🔍 <b>Image Flags</b>");
      lines.push(`Risk Score: ${data.imageRiskScore ?? "N/A"}/100`);
      for (const flag of data.imageFlags) {
        lines.push(`  • [${severityLabel(flag.severity)}] ${escapeHtml(flag.description)}`);
      }
    } else if (data.imageAnalysisSkipped) {
      lines.push("");
      lines.push("🔍 <b>Image Flags</b>");
      lines.push("No product photos available.");
    }

    // Cost breakdown
    lines.push("");
    lines.push("💵 <b>Costs</b>");
    if (data.blend) {
      lines.push(`Blended: eBay ${formatCurrency(data.blend.ebayMedian)} + AI ${formatCurrency(data.blend.aiMid)}`);
    } else if (data.analysisSource === "ebay-only" && data.ebay) {
      lines.push(`Base: ${formatCurrency(data.ebay.median)} (eBay)`);
    } else if (data.analysisSource === "ai-only" && data.ai) {
      lines.push(`Base: ${formatCurrency(data.ai.mid)} (AI)`);
    }
    const costParts: string[] = [];
    if (data.salesTaxRate !== null) {
      costParts.push(`Tax: ${(data.salesTaxRate * 100).toFixed(1)}%`);
    }
    costParts.push(`Location: ${formatCurrency(data.locationCost)}`);
    lines.push(costParts.join(" · "));

    // Recommendation
    lines.push("");
    lines.push("✅ <b>Recommendation</b>");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: <b>${formatCurrency(data.maxBid.amount)}</b> — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: <b>${formatMaxBid(data.maxBid)}</b>`);
    }
    const recParts: string[] = [];
    if (data.dealScore !== null) {
      recParts.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }
    recParts.push(`Source: ${escapeHtml(data.analysisSource)}`);
    lines.push(recParts.join(" · "));

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(data.manualReview.reason)}`);
    }

    return lines.join("\n");
  },

  activeOverview(items) {
    if (items.length === 0) {
      return "No active items. Send a mac.bid URL or lot ID to analyze an item.";
    }

    const sorted = [...items].sort((a, b) => {
      if (a.dealScore === null && b.dealScore === null) return 0;
      if (a.dealScore === null) return 1;
      if (b.dealScore === null) return -1;
      return b.dealScore - a.dealScore;
    });

    const deals = sorted.filter((i) => i.isDeal).length;

    const lines: string[] = [];
    lines.push(`<b>${sorted.length} active item${sorted.length === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}</b>`);

    for (const item of sorted) {
      lines.push("");
      lines.push(`<b>${escapeHtml(item.productName)}</b>`);
      lines.push(`Bid: ${formatCurrency(item.currentBid)}`);

      if (item.maxBid.type === "value") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        if (item.isOverMax) {
          lines.push("⛔ over max");
        } else if (item.dealScore !== null) {
          lines.push(`Deal: ${formatDealScore(item.dealScore)}`);
        }
      } else if (item.maxBid.type === "not_worth_it") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        lines.push("⛔ over max");
      } else {
        lines.push("Max: N/A");
      }
    }

    return lines.join("\n");
  },
};

// --- Convenience wrappers ---

export function toTextSummary(item: AnalyzedItem): string {
  return plainText.summary!(resolveDisplayData(item));
}

export function toTextDetail(item: AnalyzedItem): string {
  return plainText.detail!(resolveDisplayData(item));
}

export function toTextTableRow(item: AnalyzedItem): string {
  return plainText.tableRow!(resolveDisplayData(item));
}

export function toHtmlSummary(item: AnalyzedItem): string {
  return telegramHtml.summary!(resolveDisplayData(item));
}

export function toHtmlDetail(item: AnalyzedItem): string {
  return telegramHtml.detail!(resolveDisplayData(item));
}

export function toHtmlActiveOverview(items: AnalyzedItem[]): string {
  return telegramHtml.activeOverview!(items.map(resolveDisplayData));
}
