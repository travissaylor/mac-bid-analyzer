import { describe, test, expect } from "bun:test";
import { parseArgs } from "./index";
import { printAnalysisSummary } from "./commands/analyze";
import type { AnalyzedItem } from "../shared/types";

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
    discount_threshold: 0.3,
    lot_fee: 3.0,
    buyers_premium_rate: 0.15,
    deal_score: 58,
    image_flags: null,
    image_risk_score: null,
    image_analysis_skipped: null,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "blended",
    user_feedback: null,
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
    const result = parseArgs(["analyze", "12345", "--force"]);
    expect(result.flags.force).toBe(true);
  });

  test("--dry-run flag", () => {
    const result = parseArgs(["analyze", "12345", "--dry-run"]);
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
    expect(() => parseArgs(["analyze", "12345", "--unknown"])).toThrow("Unknown option: --unknown");
  });

  test("multiple flags combined", () => {
    const result = parseArgs(["analyze", "12345", "--force", "--dry-run", "--threshold", "0.4"]);
    expect(result.subcommand).toBe("analyze");
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

  test("server subcommand", () => {
    const result = parseArgs(["server"]);
    expect(result.subcommand).toBe("server");
  });

  test("--feedback with text sets userFeedback and implies force", () => {
    const result = parseArgs(["analyze", "12345", "--feedback", "ignore the missing charger"]);
    expect(result.flags.feedbackProvided).toBe(true);
    expect(result.flags.userFeedback).toBe("ignore the missing charger");
    // Call site combines feedbackProvided with force — verify the inputs the call site uses:
    expect(result.flags.force || result.flags.feedbackProvided).toBe(true);
  });

  test("--feedback with empty string clears userFeedback and implies force", () => {
    const result = parseArgs(["analyze", "12345", "--feedback", ""]);
    expect(result.flags.feedbackProvided).toBe(true);
    expect(result.flags.userFeedback).toBeNull();
    expect(result.flags.force || result.flags.feedbackProvided).toBe(true);
  });

  test("--feedback with whitespace-only string clears userFeedback", () => {
    const result = parseArgs(["analyze", "12345", "--feedback", "   "]);
    expect(result.flags.feedbackProvided).toBe(true);
    expect(result.flags.userFeedback).toBeNull();
  });

  test("--feedback=text equals form sets userFeedback and implies force", () => {
    const result = parseArgs(["analyze", "12345", "--feedback=scratches on the side"]);
    expect(result.flags.feedbackProvided).toBe(true);
    expect(result.flags.userFeedback).toBe("scratches on the side");
    expect(result.flags.force || result.flags.feedbackProvided).toBe(true);
  });

  test("--feedback= empty equals form clears userFeedback", () => {
    const result = parseArgs(["analyze", "12345", "--feedback="]);
    expect(result.flags.feedbackProvided).toBe(true);
    expect(result.flags.userFeedback).toBeNull();
  });

  test("absent --feedback preserves userFeedback as undefined and does not imply force", () => {
    const result = parseArgs(["analyze", "12345"]);
    expect(result.flags.feedbackProvided).toBe(false);
    expect(result.flags.userFeedback).toBeUndefined();
    expect(result.flags.force || result.flags.feedbackProvided).toBe(false);
  });

  test("--feedback without a value throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--feedback"])).toThrow("--feedback requires a value");
  });

  test("--feedback followed by another flag throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--feedback", "--force"])).toThrow(
      "--feedback requires a value"
    );
  });
});

describe("printAnalysisSummary", () => {
  test("prints 'Analysis Complete' header for new analysis", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({ item: makeItem(), skipped: false });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("Analysis Complete");
  });

  test("prints 'Existing Analysis' header for skipped analysis", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({ item: makeItem(), skipped: true });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("Existing Analysis");
  });

  test("prints GOOD DEAL footer when current bid is below max bid", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({
        item: makeItem({ current_bid: 500, recommended_max_bid: 1200 }),
        skipped: false,
      });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("GOOD DEAL");
  });

  test("prints PASS footer when current bid exceeds max bid", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({
        item: makeItem({ current_bid: 1500, recommended_max_bid: 1200 }),
        skipped: false,
      });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("PASS");
  });

  test("prints MANUAL REVIEW for flagged items without GOOD DEAL/PASS", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({
        item: makeItem({
          needs_manual_review: 1,
          manual_review_reason: "Condition requires review",
          recommended_max_bid: null,
          deal_score: null,
        }),
        skipped: false,
      });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("MANUAL REVIEW");
    expect(output).toContain("Condition requires review");
    expect(output).not.toContain("GOOD DEAL");
    expect(output).not.toContain("PASS");
  });

  test("includes product name and key fields from summary", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      printAnalysisSummary({ item: makeItem(), skipped: false });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("MacBook Pro 16-inch");
    expect(output).toContain("12345");
    expect(output).toContain("$500.00");
    expect(output).toContain("$1200.00");
  });
});
