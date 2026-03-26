import type { AppConfig } from "./config";
import type { AnalyzedItem } from "./db";
import { openDatabase, getItemByLotId, upsertAnalyzedItem } from "./db";
import { searchEbay } from "./ebay";
import { loadBuildings, getLocationInfo } from "./location";
import { parseModelString, getApiKeyForProvider, createProvider } from "./llm/index";
import { generateSearchQuerySafe } from "./llm/search-query";
import { calculateImagePenalty } from "./llm/image-prompt";
import type { ImageAnalysisResult, ImageFinding } from "./llm/image-prompt";
import type { LocationInfo } from "./location";
import type { EbayPriceResult, CascadeResult } from "./ebay";

/** Summarize image findings into a concise string for LLM context and review reasons. */
function summarizeImageFindings(findings: ImageFinding[]): string {
  return findings
    .map(f => `[${f.severity.toUpperCase()}] ${f.type}: ${f.description}`)
    .join("\n");
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

/**
 * Parse a mac.bid URL or lot ID into a numeric internal lot ID.
 * Supported formats:
 *   https://mac.bid/auction/{auctionId}/lot/{lotNumber}
 *   https://www.mac.bid/auction/{auctionId}/lot/{lotNumber}
 *   {lotId} (bare numeric internal ID)
 *
 * For URLs with alphanumeric lot numbers (e.g. 2587T), fetches the page
 * to resolve the internal lot ID from SSR data.
 */
export function parseLotId(input: string): number | string {
  const trimmed = input.trim();

  // Bare numeric internal lot ID
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Full URL: /auction/{auctionId}/lot/{lotNumber}
  const auctionLot = trimmed.match(/\/auction\/([^/]+)\/lot\/([^/?\s]+)/);
  if (auctionLot) {
    const lotNumber = auctionLot[2];
    // If purely numeric, use directly
    if (/^\d+$/.test(lotNumber)) {
      return parseInt(lotNumber, 10);
    }
    // Alphanumeric lot number — return the full URL path for resolution
    return trimmed;
  }

  // /lot/{id} permalink (numeric only)
  const lotPermalink = trimmed.match(/\/lot\/(\d+)/);
  if (lotPermalink) {
    return parseInt(lotPermalink[1], 10);
  }

  throw new Error(`Cannot parse lot ID from input: ${input}`);
}

export interface ResolvedLot {
  lotId: number;
  /** Full lot data from SSR, available when resolved from a URL */
  ssrData?: Record<string, unknown>;
}

/**
 * Resolve a mac.bid URL to an internal numeric lot ID by fetching the
 * SSR page and extracting the ID from __NEXT_DATA__.
 * Returns both the ID and the full SSR lot data when available.
 */
export async function resolveLotId(input: string | number): Promise<ResolvedLot> {
  // Convert numeric ID to permalink URL so we always get SSR data
  const rawInput = typeof input === "number"
    ? `https://www.mac.bid/lot/${input}`
    : input;

  // Fetch the page and extract from __NEXT_DATA__
  const url = rawInput.startsWith("http") ? rawInput : `https://www.mac.bid${rawInput.startsWith("/") ? "" : "/"}${rawInput}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch lot page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    throw new Error("Could not find __NEXT_DATA__ in lot page");
  }

  const data = JSON.parse(match[1]);
  const currentLot = data?.props?.pageProps?.currentLot;
  const lotId = currentLot?.id;
  if (typeof lotId !== "number") {
    throw new Error("Could not extract lot ID from page data");
  }

  return { lotId, ssrData: currentLot };
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
  /** All image URLs extracted from SSR data. First is stock, rest are actual product photos. */
  image_urls: string[];
  /** True when only the stock image is available (no actual product photos). */
  stock_image_only: boolean;
  building_id: number | null;
  current_location_id: number | null;
  location: string | null;
  expected_close_date: string | null;
  is_open: boolean;
  current_bid: number;
  total_bids: number;
  watchers_count: number;
}

const MACBID_LOT_URL = "https://api.macdiscount.com/map-bid/ddb/lot";

/** Known SSR field names that may contain an array of image URLs. */
const IMAGE_ARRAY_FIELDS = ["images", "product_images", "gallery", "photos", "lot_images", "image_urls"];

/**
 * Extract all image URLs from SSR/API data.
 * Searches known array fields, then falls back to the single image_url/stock_image_url.
 * Returns a deduplicated array of URL strings.
 */
export function extractImageUrls(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // Try known array fields first
  for (const field of IMAGE_ARRAY_FIELDS) {
    const value = data[field];
    if (Array.isArray(value) && value.length > 0) {
      for (const item of value) {
        if (typeof item === "string" && item.length > 0) {
          urls.push(item);
        } else if (item && typeof item === "object") {
          // Handle objects like { url: "..." } or { src: "..." } or { image_url: "..." }
          const obj = item as Record<string, unknown>;
          const candidate = (obj.url ?? obj.src ?? obj.image_url ?? obj.href) as string | undefined;
          if (typeof candidate === "string" && candidate.length > 0) {
            urls.push(candidate);
          }
        }
      }
      if (urls.length > 0) break;
    }
  }

  // Fall back to single image fields
  if (urls.length === 0) {
    const primary = data.image_url as string | undefined;
    const stock = data.stock_image_url as string | undefined;
    if (typeof primary === "string" && primary.length > 0) {
      urls.push(primary);
    } else if (typeof stock === "string" && stock.length > 0) {
      urls.push(stock);
    }
  }

  // Deduplicate while preserving order
  return [...new Set(urls)];
}

function parseLotData(data: Record<string, unknown>, lotId: number): MacBidLotItem {
  // building_id may be nested inside auction object (SSR data)
  const auction = data.auction as Record<string, unknown> | undefined;
  const buildingId = (data.building_id ?? auction?.building_id ?? null) as number | null;
  const locationName = (data.location ?? data.auction_location ?? auction?.location_name ?? null) as string | null;
  const imageUrls = extractImageUrls(data);

  return {
    id: (data.id ?? data.lot_id ?? lotId) as number,
    auction_id: (data.auction_id ?? 0) as number,
    lot_number: String(data.lot_number ?? ""),
    product_name: (data.product_name ?? data.title ?? "") as string,
    upc: (data.upc ?? null) as string | null,
    condition: (data.condition ?? data.condition_name ?? "UNKNOWN") as string,
    retail_price: (data.retail_price ?? null) as number | null,
    category: (data.category ?? data.category_name ?? null) as string | null,
    description: (data.description ?? null) as string | null,
    image_url: (data.image_url ?? data.stock_image_url ?? null) as string | null,
    image_urls: imageUrls,
    stock_image_only: imageUrls.length <= 1,
    building_id: buildingId,
    current_location_id: (data.current_location_id ?? data.location_id ?? null) as number | null,
    location: locationName,
    expected_close_date: (data.expected_close_date ?? data.end_time ?? null) as string | null,
    is_open: data.is_open !== undefined ? Boolean(data.is_open) : true,
    current_bid: Number(data.current_bid ?? 0),
    total_bids: Number(data.total_bids ?? 0),
    watchers_count: Number(data.watchers_count ?? 0),
  };
}

export async function fetchLotItem(lotId: number, ssrData?: Record<string, unknown>): Promise<MacBidLotItem> {
  // Use SSR data if available (richer than DDB endpoint)
  if (ssrData) {
    return parseLotData(ssrData, lotId);
  }

  const url = `${MACBID_LOT_URL}/${lotId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch lot ${lotId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid lot response for lot ${lotId}`);
  }

  return parseLotData(data as Record<string, unknown>, lotId);
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

export function blendEstimates(
  aiMid: number,
  aiConfidence: number,
  ebayMedian: number,
  ebayCompCount: number,
  minEbayComps: number
): number {
  const aiWeight = aiConfidence / 100;
  const ebayWeight = Math.min(ebayCompCount / minEbayComps, 1.0);
  const totalWeight = aiWeight + ebayWeight;
  if (totalWeight === 0) return 0;
  return (aiMid * aiWeight + ebayMedian * ebayWeight) / totalWeight;
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
  options: { force?: boolean; dryRun?: boolean; ssrData?: Record<string, unknown> } = {}
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
    const lot = await fetchLotItem(lotId, options.ssrData);

    // SSR data doesn't include live bid data — fetch from DDB endpoint
    if (options.ssrData && lot.current_bid === 0) {
      try {
        const liveUrl = `${MACBID_LOT_URL}/${lotId}`;
        const liveResponse = await fetch(liveUrl);
        if (liveResponse.ok) {
          const liveData = await liveResponse.json();
          lot.current_bid = Number(liveData.current_bid ?? 0);
          lot.total_bids = Number(liveData.total_bids ?? lot.total_bids);
          lot.watchers_count = Number(liveData.watchers_count ?? lot.watchers_count);
          lot.is_open = liveData.is_open !== undefined ? Boolean(liveData.is_open) : lot.is_open;
        }
      } catch {
        log("Warning: Could not fetch live bid data.");
      }
    }

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
    log(`Location: ${locationInfo.tier} (building ${lot.building_id}, cost=$${locationInfo.extraCost})`);

    // Check if condition requires manual review
    const conditionUpper = lot.condition.toUpperCase();
    const needsManualReview = config.manual_review_conditions.includes(conditionUpper);
    let manualReviewReason: string | null = null;

    if (needsManualReview) {
      manualReviewReason = `Condition "${lot.condition}" requires manual review`;
    }

    // Parse LLM provider config (needed for both image analysis and price estimation)
    const { provider: providerName, model: modelName } = parseModelString(config.llm_model);
    const apiKey = getApiKeyForProvider(providerName, config.env);

    // Run image analysis (before price estimation so findings can inform it)
    let imageAnalysisResult: ImageAnalysisResult | null = null;
    let imageRedFlagsSummary: string | null = null;

    if (!lot.stock_image_only && apiKey) {
      log(`Analyzing ${lot.image_urls.length} product image(s) for red flags...`);
      try {
        const provider = await createProvider(providerName, modelName, apiKey);
        imageAnalysisResult = await provider.analyzeImages({
          productName: lot.product_name,
          condition: lot.condition,
          category: lot.category,
          imageUrls: lot.image_urls,
        });

        // If LLM says all images are stock/generic, treat as skipped
        if (imageAnalysisResult.stockImageOnly) {
          log(`Image analysis: LLM determined all images are stock/generic — skipping.`);
          imageAnalysisResult = null;
        } else if (imageAnalysisResult.findings.length > 0) {
          imageRedFlagsSummary = summarizeImageFindings(imageAnalysisResult.findings);
          log(`Image analysis: ${imageAnalysisResult.findings.length} finding(s), risk=${imageAnalysisResult.overallRisk}`);
        } else {
          log(`Image analysis: No red flags found.`);
        }
      } catch (err) {
        log(`Warning: Image analysis failed: ${(err as Error).message}`);
      }
    } else if (lot.stock_image_only) {
      log(`Stock image only — skipping image analysis.`);
    }

    // Generate optimized search query using LLM
    const { query: searchQuery, source: querySource } = await generateSearchQuerySafe(
      {
        productName: lot.product_name,
        description: lot.description,
        upc: lot.upc,
        category: lot.category,
        condition: lot.condition,
      },
      config.llm_model,
      config.env,
    );
    if (querySource === "llm") {
      log(`LLM search query: "${searchQuery}"`);
    }

    // Run eBay search with cascade strategy
    log(`Searching eBay for comps...`);
    let cascadeResult: CascadeResult | null = null;
    let ebayResult: EbayPriceResult | null = null;
    try {
      cascadeResult = await searchEbay(
        config.env.ebayAppId,
        config.env.ebayAppSecret,
        lot.upc,
        searchQuery,
        lot.condition,
        { minComps: config.min_ebay_comps, logger: log },
      );
      ebayResult = cascadeResult?.result ?? null;
    } catch (err) {
      log(`Warning: eBay search failed: ${(err as Error).message}`);
    }

    const ebayCount = ebayResult?.count ?? 0;
    const ebayMedian = ebayResult?.median ?? 0;
    const filtersRelaxed = cascadeResult?.filtersRelaxed ?? false;
    if (filtersRelaxed) {
      log(`eBay results came from relaxed condition filters — comps may include mixed conditions.`);
    }

    // Run LLM estimate when API key is available for the configured provider
    let llmEstimateLow: number | null = null;
    let llmEstimateMid: number | null = null;
    let llmEstimateHigh: number | null = null;
    let llmProvider: string | null = null;
    let llmConfidence: number | null = null;
    let llmReasoning: string | null = null;
    let llmComparables: string | null = null;

    if (apiKey) {
      log(`Running ${providerName} estimate (${modelName})...`);
      try {
        const provider = await createProvider(providerName, modelName, apiKey);
        const llmResult = await provider.estimate({
          productName: lot.product_name,
          upc: lot.upc,
          condition: lot.condition,
          retailPrice: lot.retail_price,
          category: lot.category,
          description: lot.description,
          ebaySoldMedian: ebayResult?.median ?? null,
          ebaySoldCount: ebayCount > 0 ? ebayCount : null,
          ebaySearchQuery: ebayResult?.searchQuery ?? null,
          ebaySearchStrategy: ebayResult?.strategy ?? null,
          ebayFiltersRelaxed: filtersRelaxed || null,
          imageRedFlags: imageRedFlagsSummary,
        });

        llmEstimateLow = llmResult.low;
        llmEstimateMid = llmResult.mid;
        llmEstimateHigh = llmResult.high;
        llmProvider = providerName;
        llmConfidence = llmResult.confidence ?? null;
        llmReasoning = llmResult.reasoning ?? null;
        llmComparables = llmResult.comparables ? JSON.stringify(llmResult.comparables) : null;
        log(`${providerName} estimate: $${llmResult.low.toFixed(2)} / $${llmResult.mid.toFixed(2)} / $${llmResult.high.toFixed(2)}`);
      } catch (err) {
        log(`${providerName} estimate failed: ${(err as Error).message}`);
      }
    } else {
      log(`Warning: No API key found for ${providerName} — skipping AI estimation`);
    }

    // Apply image analysis confidence penalties
    if (imageAnalysisResult && imageAnalysisResult.findings.length > 0 && llmConfidence !== null) {
      const penalty = calculateImagePenalty(imageAnalysisResult.findings);
      const adjusted = Math.max(0, llmConfidence + penalty);
      log(`Image penalty: ${penalty} (confidence ${llmConfidence} → ${adjusted})`);
      llmConfidence = adjusted;

      // Flag for manual review with finding summary
      const topFindings = imageAnalysisResult.findings
        .filter(f => f.severity === "high" || f.severity === "medium")
        .slice(0, 3)
        .map(f => `${f.severity}: ${f.description}`)
        .join("; ");
      const reviewReason = `Image red flags detected: ${topFindings || imageRedFlagsSummary}`;
      if (!manualReviewReason) {
        manualReviewReason = reviewReason;
      } else {
        manualReviewReason += ` | ${reviewReason}`;
      }
    }

    // Calculate max bid
    let recommendedMaxBid: number | null = null;
    let analysisSource = "none";

    const hasEbay = ebayCount >= config.min_ebay_comps;
    const hasAi = llmProvider !== null && llmEstimateMid !== null;

    if (needsManualReview) {
      // No auto-recommendation for manual review conditions
      analysisSource = "manual_review";
      log(`Item condition "${lot.condition}" flagged for manual review — no auto-recommendation.`);
    } else if (hasEbay && hasAi && llmConfidence !== null) {
      // Both sources available — use weighted blend
      analysisSource = "blended";
      const blended = blendEstimates(llmEstimateMid!, llmConfidence, ebayMedian, ebayCount, config.min_ebay_comps);
      recommendedMaxBid = calculateMaxBid(
        blended,
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
    } else if (hasEbay) {
      // Enough comps but no AI — calculate max bid from eBay only
      analysisSource = "ebay";
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
    } else if (hasAi) {
      // Not enough comps but AI estimate available — use AI directly
      analysisSource = "ai";
      recommendedMaxBid = calculateMaxBid(
        llmEstimateMid!,
        config.discount_threshold,
        config.lot_fee,
        config.buyers_premium_rate,
        locationInfo.salesTaxRate,
        locationInfo.extraCost
      );
      log(`Only ${ebayCount} eBay comp(s) found. Using AI estimate for max bid.`);

      if (recommendedMaxBid <= 0) {
        manualReviewReason = "Max bid calculates to zero or negative — not worth it";
        log(`Max bid is $${recommendedMaxBid.toFixed(2)} — not worth it at this location.`);
      }
    } else {
      // No sufficient data from either source
      analysisSource = "none";
      manualReviewReason = `Only ${ebayCount} eBay comp(s) found and no AI estimate available.`;
      log(`Only ${ebayCount} eBay comp(s) found and no AI estimate available.`);
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
      llm_estimate_low: llmEstimateLow,
      llm_estimate_mid: llmEstimateMid,
      llm_estimate_high: llmEstimateHigh,
      llm_provider: llmProvider,
      llm_confidence: llmConfidence,
      llm_reasoning: llmReasoning,
      llm_comparables: llmComparables,
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

