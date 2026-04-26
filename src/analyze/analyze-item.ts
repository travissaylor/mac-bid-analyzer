import type { AppConfig } from "../config";
import type { AnalyzedItem, AnalyzeResult } from "../shared/types";
import { openDatabase, getItemByLotId, upsertAnalyzedItem } from "../db";
import { searchEbay } from "../ebay";
import { loadBuildings, getLocationInfo } from "../location";
import { parseModelString, getApiKeyForProvider, createProvider } from "../llm/index";
import { generateSearchQuerySafe } from "../llm/search-query";
import { calculateImagePenalty } from "../llm/image-prompt";
import type { ImageAnalysisResult } from "../llm/image-prompt";
import type { LocationInfo } from "../location";
import type { EbayPriceResult, CascadeResult } from "./search";
import { fetchLotItem, MACBID_LOT_URL } from "./parse";
import { calculateMaxBid, calculateDealScore } from "./estimate";
import { summarizeImageFindings } from "./images";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export async function analyzeItem(
  lotId: number,
  config: AppConfig,
  options: { force?: boolean; dryRun?: boolean; ssrData?: Record<string, unknown>; userFeedback?: string | null } = {}
): Promise<AnalyzeResult> {
  const db = openDatabase();

  try {
    // Read any existing row — used for both the cache check and for
    // three-state user-feedback resolution below.
    const existingRow = getItemByLotId(db, lotId);

    // Check if already analyzed
    if (!options.force && existingRow) {
      log(`Lot ${lotId} already analyzed. Use --force to re-analyze.`);
      return { item: existingRow, skipped: true };
    }

    // Three-state resolution for user feedback:
    //  - undefined → preserve existing persisted value (if any)
    //  - null      → clear
    //  - string    → set-and-use
    const resolvedFeedback: string | null =
      options.userFeedback === undefined
        ? (existingRow?.user_feedback ?? null)
        : options.userFeedback;

    const hasFeedback =
      typeof resolvedFeedback === "string" && resolvedFeedback.trim().length > 0;
    const feedbackForPrompts = hasFeedback ? resolvedFeedback : null;

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

    // Check if condition requires manual review. When the user has supplied
    // feedback, suppress the condition-based gate so a DAMAGED lot with user
    // context still gets a recommendation. Image-derived manual review reasons
    // below still fire regardless.
    const conditionUpper = lot.condition.toUpperCase();
    let needsManualReview = hasFeedback
      ? false
      : config.manual_review_conditions.includes(conditionUpper);
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
          userContext: feedbackForPrompts,
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
        userContext: feedbackForPrompts,
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
          userContext: feedbackForPrompts,
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
    } else if (hasAi) {
      // AI estimate available — use AI mid directly (eBay data already informs the LLM)
      analysisSource = "ai";
      recommendedMaxBid = calculateMaxBid(
        llmEstimateMid!,
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
      discount_threshold: recommendedMaxBid !== null ? config.discount_threshold : null,
      lot_fee: recommendedMaxBid !== null ? config.lot_fee : null,
      buyers_premium_rate: recommendedMaxBid !== null ? config.buyers_premium_rate : null,
      deal_score: dealScore,
      image_flags: imageAnalysisResult?.findings.length ? JSON.stringify(imageAnalysisResult.findings) : null,
      image_risk_score: imageAnalysisResult?.overallRisk ?? null,
      image_analysis_skipped: lot.stock_image_only ? 1 : 0,
      needs_manual_review: (needsManualReview || manualReviewReason !== null) ? 1 : 0,
      manual_review_reason: manualReviewReason,
      analyzed_at: new Date().toISOString(),
      analysis_source: analysisSource,
      user_feedback: resolvedFeedback,
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
