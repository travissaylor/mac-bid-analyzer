import { describe, test, expect } from "bun:test";
import { parseArgs, printItemDetail } from "./cli";
import type { AnalyzedItem } from "./db";

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
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "blended",
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("no args returns help subcommand", () => {
    const result = parseArgs([]);
    expect(result.subcommand).toBe("help");
  });

  test("--help alone returns help subcommand", () => {
    const result = parseArgs(["--help"]);
    expect(result.subcommand).toBe("help");
    expect(result.flags.help).toBe(true);
  });

  test("analyze subcommand with lot ID", () => {
    const result = parseArgs(["analyze", "12345"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.input).toBe("12345");
  });

  test("analyze subcommand with URL", () => {
    const result = parseArgs(["analyze", "https://mac.bid/auction/XYZ/lot/12345"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.input).toBe("https://mac.bid/auction/XYZ/lot/12345");
  });

  test("analyze without input throws", () => {
    expect(() => parseArgs(["analyze"])).toThrow("analyze requires an input");
  });

  test("analyze --help does not require input", () => {
    const result = parseArgs(["analyze", "--help"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.flags.help).toBe(true);
  });

  test("watchlist subcommand", () => {
    const result = parseArgs(["watchlist"]);
    expect(result.subcommand).toBe("watchlist");
  });

  test("results subcommand", () => {
    const result = parseArgs(["results"]);
    expect(result.subcommand).toBe("results");
  });

  test("results --open flag", () => {
    const result = parseArgs(["results", "--open"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.open).toBe(true);
  });

  test("results --deals flag", () => {
    const result = parseArgs(["results", "--deals"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.deals).toBe(true);
  });

  test("results --review flag", () => {
    const result = parseArgs(["results", "--review"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.review).toBe(true);
  });

  test("--force flag", () => {
    const result = parseArgs(["watchlist", "--force"]);
    expect(result.flags.force).toBe(true);
  });

  test("--dry-run flag", () => {
    const result = parseArgs(["watchlist", "--dry-run"]);
    expect(result.flags.dryRun).toBe(true);
  });

  test("--threshold flag with valid value", () => {
    const result = parseArgs(["analyze", "12345", "--threshold", "0.25"]);
    expect(result.flags.threshold).toBe(0.25);
  });

  test("--threshold without value throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--threshold"])).toThrow("--threshold requires a numeric value");
  });

  test("--threshold with invalid value throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--threshold", "1.5"])).toThrow(
      "--threshold must be a number between 0 and 1"
    );
  });

  test("unknown subcommand throws", () => {
    expect(() => parseArgs(["foobar"])).toThrow("Unknown subcommand: foobar");
  });

  test("unknown option throws", () => {
    expect(() => parseArgs(["watchlist", "--unknown"])).toThrow("Unknown option: --unknown");
  });

  test("multiple flags combined", () => {
    const result = parseArgs(["watchlist", "--force", "--dry-run", "--threshold", "0.4"]);
    expect(result.subcommand).toBe("watchlist");
    expect(result.flags.force).toBe(true);
    expect(result.flags.dryRun).toBe(true);
    expect(result.flags.threshold).toBe(0.4);
  });

  test("detail subcommand with lot ID", () => {
    const result = parseArgs(["detail", "12345"]);
    expect(result.subcommand).toBe("detail");
    expect(result.input).toBe("12345");
  });

  test("detail without lot ID throws", () => {
    expect(() => parseArgs(["detail"])).toThrow("detail requires a lot ID");
  });

  test("detail --help does not require input", () => {
    const result = parseArgs(["detail", "--help"]);
    expect(result.subcommand).toBe("detail");
    expect(result.flags.help).toBe(true);
  });
});

describe("printItemDetail", () => {
  test("displays full detail for item with all data", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printItemDetail(makeItem());
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Lot 12345");
    expect(output).toContain("MacBook Pro 16-inch");
    expect(output).toContain("Like New");
    expect(output).toContain("$500.00");
    expect(output).toContain("OPEN");
    expect(output).toContain("blended");
    // eBay section
    expect(output).toContain("eBay Data");
    expect(output).toContain("$1800.00");
    expect(output).toContain("8");
    expect(output).toContain("MacBook Pro 16");
    // AI section
    expect(output).toContain("AI Analysis");
    expect(output).toContain("gemini-2.5-flash");
    expect(output).toContain("$1900.00");
    expect(output).toContain("82/100");
    expect(output).toContain("retains strong value");
    expect(output).toContain("MacBook Pro 16 M3 Pro");
    expect(output).toContain("$1950.00");
    // Recommendation
    expect(output).toContain("$1200.00");
    expect(output).toContain("58%");
  });

  test("handles item with no AI analysis", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printItemDetail(makeItem({
        llm_provider: null,
        llm_estimate_low: null,
        llm_estimate_mid: null,
        llm_estimate_high: null,
        llm_confidence: null,
        llm_reasoning: null,
        llm_comparables: null,
        analysis_source: "ebay",
      }));
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("No AI analysis available");
  });

  test("handles item with no eBay comps", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printItemDetail(makeItem({
        ebay_sold_median: null,
        ebay_sold_low: null,
        ebay_sold_high: null,
        ebay_sold_count: 0,
        ebay_search_query: null,
        analysis_source: "ai",
      }));
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("No eBay comps found");
  });

  test("handles item needing manual review", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printItemDetail(makeItem({
        needs_manual_review: 1,
        manual_review_reason: "Low confidence",
      }));
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Low confidence");
  });

  test("handles null recommended_max_bid", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printItemDetail(makeItem({ recommended_max_bid: null, deal_score: null }));
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Max Bid:     N/A");
  });
});
