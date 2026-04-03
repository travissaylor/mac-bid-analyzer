import { describe, test, expect } from "bun:test";
import type { AnalyzedItem } from "./db";
import {
  resolveDisplayData,
  plainText,
  telegramHtml,
  formatTimeRemaining,
  isEndingSoon,
  type ItemDisplayData,
} from "./format";

function makeItem(overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    lot_id: 12345,
    auction_id: 100,
    lot_number: "A1",
    product_name: "MacBook Pro 16-inch",
    upc: null,
    condition: "Like New",
    retail_price: 2499,
    category: "Laptops",
    description: "A laptop",
    image_url: null,
    building_id: 1,
    location_id: 1,
    auction_location: "Pittsburgh",
    expected_close_date: null,
    is_open: 1,
    current_bid: 500,
    total_bids: 10,
    watchers_count: 5,
    live_updated_at: null,
    ebay_sold_median: 1800,
    ebay_sold_low: 1500,
    ebay_sold_high: 2100,
    ebay_sold_count: 8,
    ebay_search_query: "MacBook Pro 16",
    llm_estimate_low: 1600,
    llm_estimate_mid: 1900,
    llm_estimate_high: 2200,
    llm_provider: "gemini-2.5-flash",
    llm_confidence: 82,
    llm_reasoning: "High-end laptop in like-new condition retains strong value.",
    llm_comparables: JSON.stringify([
      { name: "MacBook Pro 16 M3 Pro", estimatedPrice: 1950 },
      { name: "MacBook Pro 16 M2 Pro", estimatedPrice: 1700 },
    ]),
    recommended_max_bid: 1200,
    sales_tax_rate: 0.07,
    location_cost: 5,
    location_tier: "local",
    deal_score: 58,
    image_flags: null,
    image_risk_score: null,
    image_analysis_skipped: null,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "ai",
    ...overrides,
  };
}

// ---------- resolveDisplayData ----------

describe("resolveDisplayData", () => {
  describe("max bid classification", () => {
    test("null recommended_max_bid -> unavailable", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: null }),
      );
      expect(data.maxBid).toEqual({ type: "unavailable" });
    });

    test("negative recommended_max_bid -> not_worth_it", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: -10 }),
      );
      expect(data.maxBid).toEqual({ type: "not_worth_it", amount: -10 });
    });

    test("zero recommended_max_bid -> not_worth_it", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: 0 }),
      );
      expect(data.maxBid).toEqual({ type: "not_worth_it", amount: 0 });
    });

    test("positive recommended_max_bid -> value", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: 1200 }),
      );
      expect(data.maxBid).toEqual({ type: "value", amount: 1200 });
    });
  });

  describe("eBay gating", () => {
    test("ebay_sold_count > 0 populates ebay", () => {
      const data = resolveDisplayData(makeItem());
      expect(data.ebay).not.toBeNull();
      expect(data.ebay!.median).toBe(1800);
      expect(data.ebay!.low).toBe(1500);
      expect(data.ebay!.high).toBe(2100);
      expect(data.ebay!.count).toBe(8);
    });

    test("ebay_sold_count = 0 -> ebay is null", () => {
      const data = resolveDisplayData(makeItem({ ebay_sold_count: 0 }));
      expect(data.ebay).toBeNull();
    });
  });

  describe("AI gating", () => {
    test("llm_provider and llm_estimate_mid present -> ai populated", () => {
      const data = resolveDisplayData(makeItem());
      expect(data.ai).not.toBeNull();
      expect(data.ai!.provider).toBe("gemini-2.5-flash");
      expect(data.ai!.mid).toBe(1900);
    });

    test("llm_provider null -> ai is null", () => {
      const data = resolveDisplayData(makeItem({ llm_provider: null }));
      expect(data.ai).toBeNull();
    });

    test("llm_estimate_mid null -> ai is null", () => {
      const data = resolveDisplayData(
        makeItem({ llm_estimate_mid: null }),
      );
      expect(data.ai).toBeNull();
    });
  });

  describe("comparables parsing", () => {
    test("valid JSON array -> parsed comparables", () => {
      const data = resolveDisplayData(makeItem());
      expect(data.ai!.comparables).toHaveLength(2);
      expect(data.ai!.comparables[0].name).toBe("MacBook Pro 16 M3 Pro");
    });

    test("invalid JSON -> empty array", () => {
      const data = resolveDisplayData(
        makeItem({ llm_comparables: "not json" }),
      );
      expect(data.ai!.comparables).toEqual([]);
    });

    test("null -> empty array", () => {
      const data = resolveDisplayData(
        makeItem({ llm_comparables: null }),
      );
      expect(data.ai!.comparables).toEqual([]);
    });
  });

  describe("deal flags", () => {
    test("bid below max -> isDeal true, isOverMax false", () => {
      const data = resolveDisplayData(
        makeItem({ current_bid: 500, recommended_max_bid: 1200 }),
      );
      expect(data.isDeal).toBe(true);
      expect(data.isOverMax).toBe(false);
    });

    test("bid equal to max -> isDeal true, isOverMax false", () => {
      const data = resolveDisplayData(
        makeItem({ current_bid: 1200, recommended_max_bid: 1200 }),
      );
      expect(data.isDeal).toBe(true);
      expect(data.isOverMax).toBe(false);
    });

    test("bid above max -> isDeal false, isOverMax true", () => {
      const data = resolveDisplayData(
        makeItem({ current_bid: 1500, recommended_max_bid: 1200 }),
      );
      expect(data.isDeal).toBe(false);
      expect(data.isOverMax).toBe(true);
    });

    test("null max bid -> isDeal false, isOverMax false", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: null }),
      );
      expect(data.isDeal).toBe(false);
      expect(data.isOverMax).toBe(false);
    });

    test("negative max bid -> isDeal false, isOverMax false", () => {
      const data = resolveDisplayData(
        makeItem({ recommended_max_bid: -5 }),
      );
      expect(data.isDeal).toBe(false);
      expect(data.isOverMax).toBe(false);
    });
  });

  describe("manual review", () => {
    test("needs_manual_review true with reason", () => {
      const data = resolveDisplayData(
        makeItem({
          needs_manual_review: 1,
          manual_review_reason: "Price anomaly",
        }),
      );
      expect(data.manualReview).toEqual({ reason: "Price anomaly" });
    });

    test("needs_manual_review true with null reason -> Unknown reason", () => {
      const data = resolveDisplayData(
        makeItem({
          needs_manual_review: 1,
          manual_review_reason: null,
        }),
      );
      expect(data.manualReview).toEqual({ reason: "Unknown reason" });
    });

    test("needs_manual_review false -> null", () => {
      const data = resolveDisplayData(
        makeItem({ needs_manual_review: 0 }),
      );
      expect(data.manualReview).toBeNull();
    });
  });

  test("deal_score is rounded", () => {
    const data = resolveDisplayData(makeItem({ deal_score: 58.7 }));
    expect(data.dealScore).toBe(59);
  });

  test("deal_score null stays null", () => {
    const data = resolveDisplayData(makeItem({ deal_score: null }));
    expect(data.dealScore).toBeNull();
  });

  describe("image flags", () => {
    test("parses image_flags JSON into imageFlags array", () => {
      const flags = [
        { type: "damage" as const, severity: "high" as const, description: "cracked", imageIndex: 1 },
      ];
      const data = resolveDisplayData(
        makeItem({ image_flags: JSON.stringify(flags), image_risk_score: 60 }),
      );
      expect(data.imageFlags).toEqual(flags);
      expect(data.imageRiskScore).toBe(60);
    });

    test("null image_flags -> imageFlags null", () => {
      const data = resolveDisplayData(makeItem({ image_flags: null }));
      expect(data.imageFlags).toBeNull();
    });

    test("empty array image_flags -> imageFlags null", () => {
      const data = resolveDisplayData(makeItem({ image_flags: "[]" }));
      expect(data.imageFlags).toBeNull();
    });

    test("image_analysis_skipped 1 -> true", () => {
      const data = resolveDisplayData(makeItem({ image_analysis_skipped: 1 }));
      expect(data.imageAnalysisSkipped).toBe(true);
    });

    test("image_analysis_skipped null -> false", () => {
      const data = resolveDisplayData(makeItem({ image_analysis_skipped: null }));
      expect(data.imageAnalysisSkipped).toBe(false);
    });
  });

  test("is_open 1 -> true, 0 -> false", () => {
    expect(resolveDisplayData(makeItem({ is_open: 1 })).isOpen).toBe(true);
    expect(resolveDisplayData(makeItem({ is_open: 0 })).isOpen).toBe(false);
  });
});

// ---------- Helper to make display data directly ----------

function makeDisplayData(
  overrides: Partial<ItemDisplayData> = {},
): ItemDisplayData {
  return {
    lotId: 12345,
    productName: "MacBook Pro 16-inch",
    condition: "Like New",
    currentBid: 500,
    totalBids: 10,
    isOpen: true,
    auctionLocation: "Pittsburgh",
    locationTier: "local",
    locationCost: 5,
    analyzedAt: "2026-03-22T10:00:00Z",
    analysisSource: "ai",
    ebay: {
      median: 1800,
      low: 1500,
      high: 2100,
      count: 8,
      searchQuery: "MacBook Pro 16",
    },
    ai: {
      provider: "gemini-2.5-flash",
      low: 1600,
      mid: 1900,
      high: 2200,
      confidence: 82,
      reasoning: "High-end laptop retains value.",
      comparables: [
        { name: "MacBook Pro 16 M3 Pro", estimatedPrice: 1950 },
      ],
    },
    maxBid: { type: "value", amount: 1200 },
    dealScore: 58,
    salesTaxRate: 0.07,
    manualReview: null,
    isDeal: true,
    isOverMax: false,
    imageFlags: null,
    imageRiskScore: null,
    imageAnalysisSkipped: false,
    expectedCloseDate: "2026-03-28T18:00:00Z",
    ...overrides,
  };
}

// ---------- formatTimeRemaining ----------

describe("formatTimeRemaining", () => {
  const now = new Date("2026-03-27T12:00:00Z");

  test("returns days and hours for >24h", () => {
    expect(formatTimeRemaining("2026-03-30T18:00:00Z", now)).toBe("3d 6h");
  });

  test("returns hours and minutes for >1h", () => {
    expect(formatTimeRemaining("2026-03-27T14:15:00Z", now)).toBe("2h 15m");
  });

  test("returns minutes only for <1h", () => {
    expect(formatTimeRemaining("2026-03-27T12:45:00Z", now)).toBe("45m");
  });

  test("returns 0m for exactly now", () => {
    expect(formatTimeRemaining("2026-03-27T12:00:00Z", now)).toBe("Ended");
  });

  test("returns Ended for past dates", () => {
    expect(formatTimeRemaining("2026-03-26T10:00:00Z", now)).toBe("Ended");
  });

  test("returns End time unknown for null", () => {
    expect(formatTimeRemaining(null, now)).toBe("End time unknown");
  });

  test("returns End time unknown for malformed date", () => {
    expect(formatTimeRemaining("not-a-date", now)).toBe("End time unknown");
  });

  test("1d 0h for exactly 24 hours", () => {
    expect(formatTimeRemaining("2026-03-28T12:00:00Z", now)).toBe("1d 0h");
  });
});

// ---------- isEndingSoon ----------

describe("isEndingSoon", () => {
  const now = new Date("2026-03-27T12:00:00Z");

  test("returns true for item ending in 30 minutes", () => {
    expect(isEndingSoon("2026-03-27T12:30:00Z", now)).toBe(true);
  });

  test("returns true for item ending in exactly 60 minutes (inclusive)", () => {
    expect(isEndingSoon("2026-03-27T13:00:00Z", now)).toBe(true);
  });

  test("returns false for item ending in 61 minutes", () => {
    expect(isEndingSoon("2026-03-27T13:01:00Z", now)).toBe(false);
  });

  test("returns false for item ending in 2 hours", () => {
    expect(isEndingSoon("2026-03-27T14:00:00Z", now)).toBe(false);
  });

  test("returns false for past close date", () => {
    expect(isEndingSoon("2026-03-27T11:00:00Z", now)).toBe(false);
  });

  test("returns false for null close date", () => {
    expect(isEndingSoon(null, now)).toBe(false);
  });

  test("returns false for malformed date", () => {
    expect(isEndingSoon("not-a-date", now)).toBe(false);
  });
});

// ---------- plainText renderer ----------

describe("plainText", () => {
  describe("summary", () => {
    test("contains expected labels and values", () => {
      const result = plainText.summary!(makeDisplayData());
      expect(result).toContain("MacBook Pro 16-inch");
      expect(result).toContain("Lot: 12345");
      expect(result).toContain("Condition: Like New");
      expect(result).toContain("Current Bid: $500.00 (10 bids)");
      expect(result).toContain("eBay Median: $1800.00 (8 comps)");
      expect(result).toContain("AI Estimate: $1900.00 (confidence: 82)");
      expect(result).toContain("Max Bid: $1200.00");
      expect(result).toContain("Deal Score: 58%");
      expect(result).toContain("Source: ai");
    });

    test("no eBay comps shows 'None found'", () => {
      const result = plainText.summary!(makeDisplayData({ ebay: null }));
      expect(result).toContain("eBay Comps: None found");
    });

    test("manual review appends warning", () => {
      const result = plainText.summary!(
        makeDisplayData({ manualReview: { reason: "Price anomaly" } }),
      );
      expect(result).toContain("⚠️ MANUAL REVIEW: Price anomaly");
    });

    test("not_worth_it max bid", () => {
      const result = plainText.summary!(
        makeDisplayData({
          maxBid: { type: "not_worth_it", amount: -5 },
        }),
      );
      expect(result).toContain("NOT WORTH IT");
    });

    test("unavailable max bid shows N/A", () => {
      const result = plainText.summary!(
        makeDisplayData({ maxBid: { type: "unavailable" } }),
      );
      expect(result).toContain("Max Bid: N/A");
    });

    test("shows image flags summary when present", () => {
      const result = plainText.summary!(
        makeDisplayData({
          imageFlags: [
            { type: "damage", severity: "high", description: "cracked screen", imageIndex: 1 },
            { type: "missing_parts", severity: "low", description: "missing power cable", imageIndex: 2 },
          ],
          imageRiskScore: 65,
        }),
      );
      expect(result).toContain("🔍 Image flags: cracked screen, missing power cable");
    });

    test("shows no product photos when analysis skipped", () => {
      const result = plainText.summary!(
        makeDisplayData({ imageAnalysisSkipped: true }),
      );
      expect(result).toContain("📷 No product photos available");
    });

    test("no image line when flags null and not skipped", () => {
      const result = plainText.summary!(makeDisplayData());
      expect(result).not.toContain("Image flags");
      expect(result).not.toContain("No product photos");
    });
  });

  describe("detail", () => {
    test("contains eBay, AI, and recommendation sections", () => {
      const result = plainText.detail!(makeDisplayData());
      expect(result).toContain("--- eBay Data ---");
      expect(result).toContain(
        "Low: $1500.00 | Mid: $1800.00 | High: $2100.00",
      );
      expect(result).toContain("--- AI Analysis ---");
      expect(result).toContain(
        "Low: $1600.00 | Mid: $1900.00 | High: $2200.00",
      );
      expect(result).toContain("Confidence: 82/100");
      expect(result).toContain("Reasoning: High-end laptop retains value.");
      expect(result).toContain("--- Cost Breakdown ---");
      expect(result).toContain("Base Estimate (AI): $1900.00");
      expect(result).toContain("Sales Tax Rate: 7.0%");
      expect(result).toContain("Location Cost: $5.00");
      expect(result).toContain("--- Recommendation ---");
      expect(result).toContain("Max Bid: $1200.00");
    });

    test("no eBay comps shows fallback", () => {
      const result = plainText.detail!(makeDisplayData({ ebay: null }));
      expect(result).toContain("No eBay comps found.");
    });

    test("no AI shows fallback", () => {
      const result = plainText.detail!(makeDisplayData({ ai: null }));
      expect(result).toContain("No AI analysis available.");
    });

    test("comparables listed", () => {
      const result = plainText.detail!(makeDisplayData());
      expect(result).toContain("Comparables:");
      expect(result).toContain("MacBook Pro 16 M3 Pro: $1950.00");
    });

    test("ebay source shows base estimate", () => {
      const result = plainText.detail!(
        makeDisplayData({
          analysisSource: "ebay",
          ebay: {
            median: 1800,
            low: 1500,
            high: 2100,
            count: 8,
            searchQuery: null,
          },
        }),
      );
      expect(result).toContain("Base Estimate (eBay): $1800.00");
    });

    test("ai source shows base estimate", () => {
      const result = plainText.detail!(
        makeDisplayData({
          analysisSource: "ai",
          ai: {
            provider: "gemini",
            low: 1600,
            mid: 1900,
            high: 2200,
            confidence: null,
            reasoning: null,
            comparables: [],
          },
        }),
      );
      expect(result).toContain("Base Estimate (AI): $1900.00");
    });

    test("shows image flags breakdown with severity", () => {
      const result = plainText.detail!(
        makeDisplayData({
          imageFlags: [
            { type: "damage", severity: "high", description: "cracked screen", imageIndex: 1 },
            { type: "missing_parts", severity: "medium", description: "missing charger", imageIndex: 2 },
          ],
          imageRiskScore: 70,
        }),
      );
      expect(result).toContain("--- Image Flags ---");
      expect(result).toContain("Risk Score: 70/100");
      expect(result).toContain("[HIGH] cracked screen");
      expect(result).toContain("[MED] missing charger");
    });

    test("shows skipped message in detail when no product photos", () => {
      const result = plainText.detail!(
        makeDisplayData({ imageAnalysisSkipped: true }),
      );
      expect(result).toContain("--- Image Flags ---");
      expect(result).toContain("No product photos available.");
    });
  });

  describe("tableRow", () => {
    test("contains lot id, name, condition, bid, max bid, score, status", () => {
      const result = plainText.tableRow!(makeDisplayData());
      expect(result).toContain("12345");
      expect(result).toContain("MacBook Pro 16-inch");
      expect(result).toContain("Like New");
      expect(result).toContain("$500.00");
      expect(result).toContain("$1200.00");
      expect(result).toContain("58%");
      expect(result).toContain("OPEN");
    });

    test("truncates long product names", () => {
      const result = plainText.tableRow!(
        makeDisplayData({
          productName:
            "Apple MacBook Pro 16-inch with M3 Max Chip and 64GB RAM",
        }),
      );
      expect(result).toContain("…");
      // truncated name should be 38 chars (37 + ellipsis)
    });

    test("closed item shows CLOSED", () => {
      const result = plainText.tableRow!(
        makeDisplayData({ isOpen: false }),
      );
      expect(result).toContain("CLOSED");
    });

    test("manual review shows [REVIEW]", () => {
      const result = plainText.tableRow!(
        makeDisplayData({ manualReview: { reason: "test" } }),
      );
      expect(result).toContain("[REVIEW]");
    });
  });

  describe("table", () => {
    test("has header, separator, and rows", () => {
      const items = [makeDisplayData(), makeDisplayData({ lotId: 99999 })];
      const result = plainText.table!(items);
      const lines = result.split("\n");
      expect(lines[0]).toContain("Lot ID");
      expect(lines[0]).toContain("Product Name");
      expect(lines[0]).toContain("Max Bid");
      // separator is all dashes
      expect(lines[1]).toMatch(/^-+$/);
      // two data rows
      expect(lines).toHaveLength(4);
      expect(lines[3]).toContain("99999");
    });
  });

  describe("activeOverview", () => {
    test("empty items", () => {
      const result = plainText.activeOverview!([]);
      expect(result).toBe("No active items.");
    });

    test("sorts by expectedCloseDate ascending, nulls last with deal score fallback", () => {
      const items = [
        makeDisplayData({ productName: "Later", expectedCloseDate: "2026-03-30T18:00:00Z", dealScore: 90 }),
        makeDisplayData({ productName: "Sooner", expectedCloseDate: "2026-03-28T12:00:00Z", dealScore: 30 }),
        makeDisplayData({ productName: "NullHigh", expectedCloseDate: null, dealScore: 80 }),
        makeDisplayData({ productName: "NullLow", expectedCloseDate: null, dealScore: 20 }),
      ];
      const result = plainText.activeOverview!(items);
      const soonerIdx = result.indexOf("Sooner");
      const laterIdx = result.indexOf("Later");
      const nullHighIdx = result.indexOf("NullHigh");
      const nullLowIdx = result.indexOf("NullLow");
      expect(soonerIdx).toBeLessThan(laterIdx);
      expect(laterIdx).toBeLessThan(nullHighIdx);
      expect(nullHighIdx).toBeLessThan(nullLowIdx);
    });

    test("shows item count and deal count", () => {
      const items = [
        makeDisplayData({ isDeal: true }),
        makeDisplayData({ isDeal: false, isOverMax: true }),
      ];
      const result = plainText.activeOverview!(items);
      expect(result).toContain("2 active items, 1 deal");
    });

    test("over max indicator", () => {
      const result = plainText.activeOverview!([
        makeDisplayData({
          isOverMax: true,
          isDeal: false,
          currentBid: 1500,
          maxBid: { type: "value", amount: 1200 },
        }),
      ]);
      expect(result).toContain("⛔ over max");
    });

    test("shows time remaining for items with close date", () => {
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: "2099-01-01T00:00:00Z" }),
      ]);
      expect(result).toContain("⏰");
    });

    test("shows End time unknown for null close date", () => {
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: null }),
      ]);
      expect(result).toContain("⏰ End time unknown");
    });

    test("shows fire emoji for item ending within 1 hour", () => {
      const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: soon }),
      ]);
      expect(result).toContain("🔥");
    });

    test("no fire emoji for item ending in more than 1 hour", () => {
      const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: later }),
      ]);
      expect(result).not.toContain("🔥");
    });

    test("no fire emoji for null close date", () => {
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: null }),
      ]);
      expect(result).not.toContain("🔥");
    });

    test("no fire emoji for past close date", () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = plainText.activeOverview!([
        makeDisplayData({ expectedCloseDate: past }),
      ]);
      expect(result).not.toContain("🔥");
    });
  });
});

// ---------- telegramHtml renderer ----------

describe("telegramHtml", () => {
  describe("summary", () => {
    test("contains key data with emoji markers", () => {
      const result = telegramHtml.summary!(makeDisplayData());
      expect(result).toContain("<b>MacBook Pro 16-inch</b>");
      expect(result).toContain("Lot: 12345");
      expect(result).toContain("$500.00 (10 bids)");
      expect(result).toContain("✅ Max Bid: <b>$1200.00</b>");
      expect(result).toContain("Deal: 58%");
      expect(result).toContain("Source: ai");
      expect(result).toContain("📊 eBay:");
      expect(result).toContain("🤖 AI:");
    });

    test("manual review in HTML", () => {
      const result = telegramHtml.summary!(
        makeDisplayData({ manualReview: { reason: "Check price" } }),
      );
      expect(result).toContain(
        "⚠️ <b>MANUAL REVIEW:</b> Check price",
      );
    });

    test("shows image flags summary in HTML", () => {
      const result = telegramHtml.summary!(
        makeDisplayData({
          imageFlags: [
            { type: "damage", severity: "high", description: "cracked screen", imageIndex: 1 },
          ],
          imageRiskScore: 50,
        }),
      );
      expect(result).toContain("🔍 Image flags: cracked screen");
    });

    test("shows no product photos when skipped in HTML", () => {
      const result = telegramHtml.summary!(
        makeDisplayData({ imageAnalysisSkipped: true }),
      );
      expect(result).toContain("📷 No product photos available");
    });
  });

  describe("detail", () => {
    test("contains cost section with emoji header", () => {
      const result = telegramHtml.detail!(makeDisplayData());
      expect(result).toContain("💵 <b>Costs</b>");
      expect(result).toContain("Base: $1900.00 (AI)");
      expect(result).toContain("Location: $5.00");
    });

    test("contains recommendation section with emoji header", () => {
      const result = telegramHtml.detail!(makeDisplayData());
      expect(result).toContain("✅ <b>Recommendation</b>");
      expect(result).toContain("Max Bid: <b>$1200.00</b>");
    });

    test("comparables use bullet points with emoji header", () => {
      const result = telegramHtml.detail!(makeDisplayData());
      expect(result).toContain("📋 <b>Comparables</b>");
      expect(result).toContain("• MacBook Pro 16 M3 Pro: $1950.00");
    });

    test("contains eBay and AI sections with emoji headers", () => {
      const result = telegramHtml.detail!(makeDisplayData());
      expect(result).toContain("📊 <b>eBay Data</b>");
      expect(result).toContain("🤖 <b>AI Analysis</b>");
    });

    test("merges lot and condition on one line", () => {
      const result = telegramHtml.detail!(makeDisplayData());
      expect(result).toContain("Lot: 12345 · Like New");
    });

    test("shows image flags breakdown in detail", () => {
      const result = telegramHtml.detail!(
        makeDisplayData({
          imageFlags: [
            { type: "damage", severity: "high", description: "cracked screen", imageIndex: 1 },
            { type: "mismatch", severity: "low", description: "color differs from listing", imageIndex: 3 },
          ],
          imageRiskScore: 55,
        }),
      );
      expect(result).toContain("🔍 <b>Image Flags</b>");
      expect(result).toContain("Risk Score: 55/100");
      expect(result).toContain("[HIGH] cracked screen");
      expect(result).toContain("[LOW] color differs from listing");
    });

    test("shows skipped in detail when no product photos", () => {
      const result = telegramHtml.detail!(
        makeDisplayData({ imageAnalysisSkipped: true }),
      );
      expect(result).toContain("🔍 <b>Image Flags</b>");
      expect(result).toContain("No product photos available.");
    });

    test("escapes HTML in image flag descriptions", () => {
      const result = telegramHtml.detail!(
        makeDisplayData({
          imageFlags: [
            { type: "damage", severity: "high", description: "crack <visible> & deep", imageIndex: 1 },
          ],
          imageRiskScore: 80,
        }),
      );
      expect(result).toContain("crack &lt;visible&gt; &amp; deep");
    });
  });

  describe("activeOverview", () => {
    test("sorts by expectedCloseDate ascending", () => {
      const items = [
        makeDisplayData({ productName: "Later", expectedCloseDate: "2026-03-30T18:00:00Z" }),
        makeDisplayData({ productName: "Sooner", expectedCloseDate: "2026-03-28T12:00:00Z" }),
      ];
      const result = telegramHtml.activeOverview!(items);
      expect(result.indexOf("Sooner")).toBeLessThan(result.indexOf("Later"));
    });

    test("empty items message", () => {
      const result = telegramHtml.activeOverview!([]);
      expect(result).toContain("No active items");
    });

    test("header is bold with counts", () => {
      const items = [
        makeDisplayData({ isDeal: true }),
        makeDisplayData({ isDeal: true }),
      ];
      const result = telegramHtml.activeOverview!(items);
      expect(result).toContain("<b>2 active items, 2 deals</b>");
    });

    test("shows time remaining for items with close date", () => {
      const result = telegramHtml.activeOverview!([
        makeDisplayData({ expectedCloseDate: "2099-01-01T00:00:00Z" }),
      ]);
      expect(result).toContain("⏰");
    });

    test("shows End time unknown for null close date", () => {
      const result = telegramHtml.activeOverview!([
        makeDisplayData({ expectedCloseDate: null }),
      ]);
      expect(result).toContain("⏰ End time unknown");
    });

    test("shows fire emoji for item ending within 1 hour", () => {
      const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const result = telegramHtml.activeOverview!([
        makeDisplayData({ expectedCloseDate: soon }),
      ]);
      expect(result).toContain("🔥");
    });

    test("no fire emoji for item ending in more than 1 hour", () => {
      const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const result = telegramHtml.activeOverview!([
        makeDisplayData({ expectedCloseDate: later }),
      ]);
      expect(result).not.toContain("🔥");
    });

    test("no fire emoji for null close date", () => {
      const result = telegramHtml.activeOverview!([
        makeDisplayData({ expectedCloseDate: null }),
      ]);
      expect(result).not.toContain("🔥");
    });
  });

  describe("HTML escaping", () => {
    test("escapes & < > in product names", () => {
      const data = makeDisplayData({
        productName: "Mac & PC <combo> test",
      });
      const summary = telegramHtml.summary!(data);
      expect(summary).toContain("Mac &amp; PC &lt;combo&gt; test");
      expect(summary).not.toContain("Mac & PC <combo>");
    });

    test("escapes reasoning text", () => {
      const data = makeDisplayData({
        ai: {
          provider: "gemini",
          low: 100,
          mid: 200,
          high: 300,
          confidence: 50,
          reasoning: "Value > expected & price < median",
          comparables: [],
        },
      });
      const detail = telegramHtml.detail!(data);
      expect(detail).toContain(
        "Value &gt; expected &amp; price &lt; median",
      );
    });

    test("escapes manual review reason", () => {
      const data = makeDisplayData({
        manualReview: { reason: "Price <$10 & suspicious" },
      });
      const summary = telegramHtml.summary!(data);
      expect(summary).toContain(
        "Price &lt;$10 &amp; suspicious",
      );
    });
  });
});
