import type { AnalyzedItem } from "../shared/types";
import type { ImageFinding } from "../llm/image-prompt";

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

export function formatImageFlagsSummary(flags: ImageFinding[]): string {
  return flags.map((f) => f.description).join(", ");
}

export function severityLabel(severity: ImageFinding["severity"]): string {
  switch (severity) {
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
}

// --- Time remaining ---

export function isEndingSoon(closeDate: string | null, now: Date = new Date()): boolean {
  if (closeDate === null) return false;
  const close = new Date(closeDate);
  if (isNaN(close.getTime())) return false;
  const diffMs = close.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= 60 * 60 * 1000;
}

export function formatTimeRemaining(closeDate: string | null, now: Date = new Date()): string {
  if (closeDate === null) return "End time unknown";
  const close = new Date(closeDate);
  if (isNaN(close.getTime())) return "End time unknown";
  const diffMs = close.getTime() - now.getTime();
  if (diffMs <= 0) return "Ended";
  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// --- Formatting helpers ---

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatMaxBid(maxBid: ItemDisplayData["maxBid"]): string {
  switch (maxBid.type) {
    case "value":
      return formatCurrency(maxBid.amount);
    case "not_worth_it":
      return "NOT WORTH IT";
    case "unavailable":
      return "N/A";
  }
}

export function formatDealScore(score: number | null): string {
  return score !== null ? `${score}%` : "N/A";
}

export function sortByEndingSoonest(items: ItemDisplayData[]): ItemDisplayData[] {
  return [...items].sort((a, b) => {
    const aDate = a.expectedCloseDate ? new Date(a.expectedCloseDate).getTime() : NaN;
    const bDate = b.expectedCloseDate ? new Date(b.expectedCloseDate).getTime() : NaN;
    const aValid = !isNaN(aDate);
    const bValid = !isNaN(bDate);

    // Both have valid dates: sort ascending (soonest first)
    if (aValid && bValid) return aDate - bDate;
    // Only one has a valid date: that one comes first
    if (aValid) return -1;
    if (bValid) return 1;
    // Neither has a valid date: fall back to deal score descending
    if (a.dealScore === null && b.dealScore === null) return 0;
    if (a.dealScore === null) return 1;
    if (b.dealScore === null) return -1;
    return b.dealScore - a.dealScore;
  });
}
