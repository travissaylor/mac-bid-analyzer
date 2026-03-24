import type { AnalyzedItem } from "./db";

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
