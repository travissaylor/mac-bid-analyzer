import { describe, test, expect } from "bun:test";
import { toFixtureItem } from "./export";
import type { AnalyzedItem } from "../db";

function makeItem(overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    lot_id: 12345,
    auction_id: 100,
    lot_number: "A1",
    product_name: "MacBook Pro 16-inch",
    upc: "123456789012",
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
    analysis_source: "blended",
    ...overrides,
  };
}

describe("toFixtureItem", () => {
  test("extracts correct fields from AnalyzedItem", () => {
    const item = makeItem();
    const fixture = toFixtureItem(item);

    expect(fixture.lot_id).toBe(12345);
    expect(fixture.product_name).toBe("MacBook Pro 16-inch");
    expect(fixture.upc).toBe("123456789012");
    expect(fixture.condition).toBe("Like New");
    expect(fixture.retail_price).toBe(2499);
    expect(fixture.category).toBe("Laptops");
    expect(fixture.description).toBe("A laptop");
    expect(fixture.ebay_sold_median).toBe(1800);
    expect(fixture.ebay_sold_count).toBe(8);
    expect(fixture.true_value).toBeNull();
  });

  test("true_value is always null", () => {
    const fixture = toFixtureItem(makeItem());
    expect(fixture.true_value).toBeNull();
  });

  test("preserves null fields", () => {
    const fixture = toFixtureItem(makeItem({
      upc: null,
      retail_price: null,
      category: null,
      description: null,
      ebay_sold_median: null,
    }));

    expect(fixture.upc).toBeNull();
    expect(fixture.retail_price).toBeNull();
    expect(fixture.category).toBeNull();
    expect(fixture.description).toBeNull();
    expect(fixture.ebay_sold_median).toBeNull();
  });

  test("does not include extra fields", () => {
    const fixture = toFixtureItem(makeItem());
    const keys = Object.keys(fixture);
    expect(keys).toEqual([
      "lot_id",
      "product_name",
      "upc",
      "condition",
      "retail_price",
      "category",
      "description",
      "ebay_sold_median",
      "ebay_sold_count",
      "ebay_search_query",
      "true_value",
    ]);
  });
});
