// Shared types for the mac.bid analyzer extension.
// These are the canonical shapes used by both the Chrome and Safari entry points.

/**
 * Information extracted from a mac.bid lot URL.
 * `auctionId` and `lotNumber` are present when the URL matched the
 * `/auction/{auctionId}/lot/{lotNumber}` pattern (or the search-preview
 * synthetic equivalent). `lotId` is always set and is what the entry point
 * uses for change-detection between navigations.
 */
export interface LotInfo {
  type: "auction_lot" | "lot";
  auctionId?: string;
  lotNumber?: string;
  lotId: string;
  path: string;
}

/**
 * Mirrors the `AnalyzedItem` interface from `src/db.ts` (the backend's
 * canonical shape). The `/api/lot` and `/api/analyze` endpoints both return
 * objects of this shape. Kept in sync with `src/db.ts` by hand.
 */
export interface AnalyzedItem {
  lot_id: number;
  auction_id: number;
  lot_number: string;
  product_name: string;
  upc: string | null;
  condition: string;
  retail_price: number | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  building_id: number | null;
  location_id: number | null;
  auction_location: string | null;
  expected_close_date: string | null;
  is_open: number;
  current_bid: number;
  total_bids: number;
  watchers_count: number;
  live_updated_at: string | null;
  ebay_sold_median: number | null;
  ebay_sold_low: number | null;
  ebay_sold_high: number | null;
  ebay_sold_count: number;
  ebay_search_query: string | null;
  llm_estimate_low: number | null;
  llm_estimate_mid: number | null;
  llm_estimate_high: number | null;
  llm_provider: string | null;
  llm_confidence: number | null;
  llm_reasoning: string | null;
  llm_comparables: string | null;
  recommended_max_bid: number | null;
  sales_tax_rate: number | null;
  location_cost: number;
  location_tier: string | null;
  deal_score: number | null;
  image_flags: string | null;
  image_risk_score: number | null;
  image_analysis_skipped: number | null;
  needs_manual_review: number;
  manual_review_reason: string | null;
  analyzed_at: string;
  analysis_source: string;
  user_feedback: string | null;
}

/** A single eBay-comparable derived from `AnalyzedItem.llm_comparables` JSON. */
export interface Comparable {
  name: string;
  estimatedPrice: number;
}

/** A single image flag derived from `AnalyzedItem.image_flags` JSON. */
export interface ImageFlag {
  severity: string;
  description: string;
}

export type MaxBidDisplay =
  | { type: "unavailable" }
  | { type: "not_worth_it"; amount: number }
  | { type: "value"; amount: number };

export interface EbayDisplay {
  median: number | null;
  low: number | null;
  high: number | null;
  count: number;
  searchQuery: string | null;
}

export interface AiDisplay {
  provider: string;
  low: number | null;
  mid: number | null;
  high: number | null;
  confidence: number | null;
  reasoning: string | null;
  comparables: Comparable[];
}

/**
 * Shape returned by `resolveDisplayData()`. Designed for direct consumption
 * by the rendering helpers in `display.ts` and `modal.ts`.
 */
export interface DisplayData {
  lotId: number;
  productName: string;
  condition: string;
  currentBid: number;
  totalBids: number;
  auctionLocation: string;
  locationTier: string;
  locationCost: number;
  analysisSource: string;
  ebay: EbayDisplay | null;
  ai: AiDisplay | null;
  maxBid: MaxBidDisplay;
  dealScore: number | null;
  salesTaxRate: number | null;
  manualReview: { reason: string } | null;
  isDeal: boolean;
  isOverMax: boolean;
  imageFlags: ImageFlag[] | null;
  imageRiskScore: number | null;
  imageAnalysisSkipped: boolean;
  userFeedback: string | null;
}

/** Options accepted by the injected fetch function. */
export interface FetchOpts {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Result of an injected fetch. `body` is `unknown` because the JSON shape is
 * endpoint-specific; callers narrow it as needed.
 */
export interface FetchResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/**
 * Pluggable HTTP transport. Entry points wrap their platform-specific
 * mechanism (e.g. `chrome.runtime.sendMessage` proxying to a service worker)
 * to satisfy this signature.
 */
export type FetchFn = (opts: FetchOpts) => Promise<FetchResult>;

/** Error subclass used to signal a missing API token to the entry point. */
export interface NoTokenError extends Error {
  code: "NO_TOKEN";
}
