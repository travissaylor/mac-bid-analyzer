import type { AppConfig } from "./config";
import type { AnalyzedItem } from "./db";
import { openDatabase, getItemByLotId, upsertAnalyzedItem } from "./db";
import { searchEbay } from "./ebay";
import { loadBuildings, getLocationInfo } from "./location";
import type { LocationInfo } from "./location";
import type { EbayPriceResult } from "./ebay";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

/**
 * Parse a mac.bid URL or lot ID into a numeric lot ID.
 * Supported formats:
 *   https://mac.bid/auction/{auctionId}/lot/{lotId}
 *   https://www.mac.bid/auction/{auctionId}/lot/{lotId}
 *   https://mac.bid/lot/{lotId}
 *   /lot/{lotId}
 *   {lotId} (bare numeric)
 */
export function parseLotId(input: string): number {
  const trimmed = input.trim();

  // Bare numeric lot ID
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // /lot/{id} permalink
  const lotPermalink = trimmed.match(/\/lot\/(\d+)/);
  if (lotPermalink) {
    return parseInt(lotPermalink[1], 10);
  }

  // Full URL: /auction/{id}/lot/{num}
  const auctionLot = trimmed.match(/\/auction\/[^/]+\/lot\/(\d+)/);
  if (auctionLot) {
    return parseInt(auctionLot[1], 10);
  }

  throw new Error(`Cannot parse lot ID from input: ${input}`);
}

export function isAsin(upc: string): boolean {
  return upc.length === 10 && upc.startsWith("B0");
}

export interface MacBidLotItem {
  id: number;
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
  current_location_id: number | null;
  location: string | null;
  expected_close_date: string | null;
  is_open: boolean;
  current_bid: number;
  total_bids: number;
  watchers_count: number;
}

const MACBID_LOT_URL = "https://api.mac.bid/map-bid/ddb/lot";

export async function fetchLotItem(lotId: number): Promise<MacBidLotItem> {
  const url = `${MACBID_LOT_URL}/${lotId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch lot ${lotId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid lot response for lot ${lotId}`);
  }

  return {
    id: data.id ?? data.lot_id ?? lotId,
    auction_id: data.auction_id ?? 0,
    lot_number: String(data.lot_number ?? ""),
    product_name: data.product_name ?? data.name ?? "",
    upc: data.upc ?? null,
    condition: data.condition ?? "UNKNOWN",
    retail_price: data.retail_price ?? null,
    category: data.category ?? null,
    description: data.description ?? null,
    image_url: data.image_url ?? data.image ?? null,
    building_id: data.building_id ?? null,
    current_location_id: data.current_location_id ?? null,
    location: data.location ?? data.auction_location ?? null,
    expected_close_date: data.expected_close_date ?? null,
    is_open: data.is_open !== undefined ? Boolean(data.is_open) : true,
    current_bid: data.current_bid ?? 0,
    total_bids: data.total_bids ?? 0,
    watchers_count: data.watchers_count ?? 0,
  };
}

export function calculateMaxBid(
  ebayMedian: number,
  discountThreshold: number,
  lotFee: number,
  buyersPremiumRate: number,
  salesTaxRate: number,
  locationCost: number
): number {
  const targetAllIn = ebayMedian * (1 - discountThreshold);
  const maxBid = (targetAllIn - lotFee - locationCost) / (1 + buyersPremiumRate + salesTaxRate);
  return Math.round(maxBid * 100) / 100;
}

export function calculateDealScore(recommendedMaxBid: number, currentBid: number): number {
  if (recommendedMaxBid <= 0) return 0;
  return ((recommendedMaxBid - currentBid) / recommendedMaxBid) * 100;
}

export interface AnalyzeResult {
  item: AnalyzedItem;
  skipped: boolean;
}

export async function analyzeItem(
  lotId: number,
  config: AppConfig,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<AnalyzeResult> {
  const db = openDatabase();

  try {
    // Check if already analyzed
    if (!options.force) {
      const existing = getItemByLotId(db, lotId);
      if (existing) {
        log(`Lot ${lotId} already analyzed. Use --force to re-analyze.`);
        return { item: existing, skipped: true };
      }
    }

    // Fetch lot data from mac.bid
    log(`Fetching lot ${lotId} from mac.bid...`);
    const lot = await fetchLotItem(lotId);

    // Get location info
    let locationInfo: LocationInfo = { tier: "remote", extraCost: config.location_tiers.remote.extra_cost, salesTaxRate: 0 };
    if (lot.building_id !== null) {
      try {
        const buildingsCache = await loadBuildings(config);
        locationInfo = getLocationInfo(buildingsCache, lot.building_id, config);
      } catch (err) {
        log(`Warning: Could not fetch buildings data: ${(err as Error).message}. Using remote tier defaults.`);
      }
    }

    // Check if condition requires manual review
    const conditionUpper = lot.condition.toUpperCase();
    const needsManualReview = config.manual_review_conditions.includes(conditionUpper);
    let manualReviewReason: string | null = null;

    if (needsManualReview) {
      manualReviewReason = `Condition "${lot.condition}" requires manual review`;
    }

    // Search eBay for comps
    log(`Searching eBay for comps...`);
    let ebayResult: EbayPriceResult | null = null;
    try {
      ebayResult = await searchEbay(
        config.env.ebayAppId,
        config.env.ebayAppSecret,
        lot.upc,
        lot.product_name,
        lot.condition
      );
    } catch (err) {
      log(`Warning: eBay search failed: ${(err as Error).message}`);
    }

    const ebayCount = ebayResult?.count ?? 0;
    const ebayMedian = ebayResult?.median ?? 0;

    // Calculate max bid
    let recommendedMaxBid: number | null = null;
    let analysisSource = "ebay";

    if (needsManualReview) {
      // No auto-recommendation for manual review conditions
      analysisSource = "manual_review";
      log(`Item condition "${lot.condition}" flagged for manual review — no auto-recommendation.`);
    } else if (ebayCount >= config.min_ebay_comps) {
      // Enough comps — calculate max bid
      recommendedMaxBid = calculateMaxBid(
        ebayMedian,
        config.discount_threshold,
        config.lot_fee,
        config.buyers_premium_rate,
        locationInfo.salesTaxRate,
        locationInfo.extraCost
      );

      if (recommendedMaxBid <= 0) {
        manualReviewReason = "Max bid calculates to zero or negative — not worth it";
        log(`Max bid is $${recommendedMaxBid.toFixed(2)} — not worth it at this location.`);
      }
    } else {
      // Not enough comps — would fall back to Gemini (US-008)
      analysisSource = "insufficient_comps";
      manualReviewReason = `Only ${ebayCount} eBay comp(s) found (minimum: ${config.min_ebay_comps}). Gemini fallback not yet implemented.`;
      log(`Only ${ebayCount} eBay comp(s) found. Gemini fallback not yet implemented — flagging for manual review.`);
    }

    const dealScore = recommendedMaxBid !== null && recommendedMaxBid > 0
      ? calculateDealScore(recommendedMaxBid, lot.current_bid)
      : null;

    const analyzedItem: AnalyzedItem = {
      lot_id: lot.id,
      auction_id: lot.auction_id,
      lot_number: lot.lot_number,
      product_name: lot.product_name,
      upc: lot.upc,
      condition: lot.condition,
      retail_price: lot.retail_price,
      category: lot.category,
      description: lot.description,
      image_url: lot.image_url,
      building_id: lot.building_id,
      location_id: lot.current_location_id,
      auction_location: lot.location,
      expected_close_date: lot.expected_close_date,
      is_open: lot.is_open ? 1 : 0,
      current_bid: lot.current_bid,
      total_bids: lot.total_bids,
      watchers_count: lot.watchers_count,
      live_updated_at: new Date().toISOString(),
      ebay_sold_median: ebayResult?.median ?? null,
      ebay_sold_low: ebayResult?.low ?? null,
      ebay_sold_high: ebayResult?.high ?? null,
      ebay_sold_count: ebayCount,
      ebay_search_query: ebayResult?.searchQuery ?? null,
      llm_estimate_low: null,
      llm_estimate_mid: null,
      llm_estimate_high: null,
      llm_provider: null,
      recommended_max_bid: recommendedMaxBid,
      sales_tax_rate: locationInfo.salesTaxRate,
      location_cost: locationInfo.extraCost,
      location_tier: locationInfo.tier,
      deal_score: dealScore,
      needs_manual_review: (needsManualReview || manualReviewReason !== null) ? 1 : 0,
      manual_review_reason: manualReviewReason,
      analyzed_at: new Date().toISOString(),
      analysis_source: analysisSource,
    };

    // Store in DB
    if (!options.dryRun) {
      upsertAnalyzedItem(db, analyzedItem);
      log(`Stored analysis for lot ${lot.id} in database.`);
    }

    return { item: analyzedItem, skipped: false };
  } finally {
    db.close();
  }
}

export function printAnalysisSummary(result: AnalyzeResult): void {
  const { item, skipped } = result;

  if (skipped) {
    log("--- Existing Analysis ---");
  } else {
    log("--- Analysis Complete ---");
  }

  console.log(`  Product:     ${item.product_name}`);
  console.log(`  Condition:   ${item.condition}`);
  console.log(`  Lot ID:      ${item.lot_id}`);
  console.log(`  Current Bid: $${item.current_bid.toFixed(2)}`);
  console.log(`  Location:    ${item.auction_location ?? "Unknown"} (${item.location_tier ?? "unknown"} tier, +$${item.location_cost.toFixed(2)})`);

  if (item.ebay_sold_count > 0) {
    console.log(`  eBay Median: $${(item.ebay_sold_median ?? 0).toFixed(2)} (${item.ebay_sold_count} comps)`);
  } else {
    console.log(`  eBay Comps:  None found`);
  }

  if (item.recommended_max_bid !== null) {
    if (item.recommended_max_bid <= 0) {
      console.log(`  Max Bid:     $${item.recommended_max_bid.toFixed(2)} — NOT WORTH IT`);
    } else {
      console.log(`  Max Bid:     $${item.recommended_max_bid.toFixed(2)}`);
    }
  } else {
    console.log(`  Max Bid:     N/A`);
  }

  if (item.deal_score !== null) {
    console.log(`  Deal Score:  ${item.deal_score.toFixed(0)}%`);
  }

  if (item.needs_manual_review) {
    console.log(`  ⚠ MANUAL REVIEW: ${item.manual_review_reason}`);
  } else if (item.recommended_max_bid !== null && item.recommended_max_bid > 0 && item.current_bid <= item.recommended_max_bid) {
    console.log(`  ✓ GOOD DEAL — current bid is below max bid`);
  } else if (item.recommended_max_bid !== null && item.recommended_max_bid > 0) {
    console.log(`  ✗ PASS — current bid exceeds max bid`);
  }
}
