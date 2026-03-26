import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runEval, saveReport, printSummaryTable, printSearchMetrics, loadPricing, calculateCost, computeSearchMetrics } from "./runner";
import type { EvalReport, PricingConfig, SearchMetrics } from "./runner";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DIR = "test-runner-tmp";
const FIXTURE_FILE = `${TEST_DIR}/fixtures.jsonl`;

const emptySearchMetrics: SearchMetrics = {
  total_items: 0,
  hit_rate: 0,
  items_with_comps: 0,
  items_without_comps: 0,
  strategy_distribution: { upc: 0, llm: 0, "llm-broad": 0, "llm-relaxed": 0, none: 0 },
};

function makeFixtureLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    lot_id: 1,
    product_name: "Test Item",
    upc: null,
    condition: "Like New",
    retail_price: 100,
    category: "Electronics",
    description: "A test item",
    ebay_sold_median: 80,
    ebay_sold_count: 5,
    true_value: 50,
    ...overrides,
  });
}

beforeEach(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("runEval", () => {
  test("throws on invalid provider", async () => {
    await Bun.write(FIXTURE_FILE, makeFixtureLine() + "\n");
    await expect(
      runEval({
        fixturePath: FIXTURE_FILE,
        models: ["foobar/some-model"],
        env: { geminiApiKey: "key", openaiApiKey: "key" },
      }),
    ).rejects.toThrow('Unsupported provider "foobar"');
  });

  test("throws on invalid model string without slash", async () => {
    await Bun.write(FIXTURE_FILE, makeFixtureLine() + "\n");
    await expect(
      runEval({
        fixturePath: FIXTURE_FILE,
        models: ["noSlash"],
        env: { geminiApiKey: "key", openaiApiKey: "key" },
      }),
    ).rejects.toThrow('Invalid model string "noSlash"');
  });

  test("throws when all models skipped due to missing API keys", async () => {
    await Bun.write(FIXTURE_FILE, makeFixtureLine() + "\n");
    await expect(
      runEval({
        fixturePath: FIXTURE_FILE,
        models: ["openai/gpt-4o"],
        env: { geminiApiKey: "key", openaiApiKey: "" },
      }),
    ).rejects.toThrow("No models to evaluate");
  });

  test("throws when no annotated items", async () => {
    await Bun.write(
      FIXTURE_FILE,
      makeFixtureLine({ true_value: null }) + "\n",
    );
    await expect(
      runEval({
        fixturePath: FIXTURE_FILE,
        models: ["gemini/test-model"],
        env: { geminiApiKey: "key", openaiApiKey: "" },
      }),
    ).rejects.toThrow("No annotated items found");
  });
});

describe("saveReport", () => {
  test("creates output directory and writes report", async () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: ["gemini/test"],
        total_items: 1,
      },
      search_metrics: emptySearchMetrics,
      summary: [],
      details: [],
    };

    const outputPath = `${TEST_DIR}/results/report.json`;
    await saveReport(report, outputPath);

    const content = await Bun.file(outputPath).json();
    expect(content.metadata.run_at).toBe("2025-01-01T00:00:00Z");
    expect(content.metadata.models).toEqual(["gemini/test"]);
  });
});

describe("loadPricing", () => {
  test("loads pricing from a valid JSON file", async () => {
    const pricingPath = `${TEST_DIR}/pricing.json`;
    await Bun.write(
      pricingPath,
      JSON.stringify({
        "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
      }),
    );
    const pricing = await loadPricing(pricingPath);
    expect(pricing["gpt-4o"]).toEqual({ inputPer1M: 2.5, outputPer1M: 10.0 });
  });

  test("returns empty object for missing file", async () => {
    const pricing = await loadPricing(`${TEST_DIR}/nonexistent.json`);
    expect(pricing).toEqual({});
  });
});

describe("calculateCost", () => {
  const pricing: PricingConfig = {
    "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  };

  test("calculates cost from usage and pricing", () => {
    const cost = calculateCost(
      { inputTokens: 1000, outputTokens: 500 },
      "gpt-4o",
      pricing,
    );
    // (1000/1M)*2.5 + (500/1M)*10.0 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  test("returns null when usage is undefined", () => {
    expect(calculateCost(undefined, "gpt-4o", pricing)).toBeNull();
  });

  test("returns null when model not in pricing", () => {
    const cost = calculateCost(
      { inputTokens: 1000, outputTokens: 500 },
      "unknown-model",
      pricing,
    );
    expect(cost).toBeNull();
  });
});

describe("printSummaryTable", () => {
  test("prints table without crashing", () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: ["gemini/test"],
        total_items: 1,
      },
      search_metrics: emptySearchMetrics,
      summary: [
        {
          model: "gemini/test",
          mae: 10.5,
          mape: 0.15,
          coverage_rate: 0.8,
          avg_cost_usd: 0.0025,
          confidence_correlation: 0.5,
          items_evaluated: 10,
          items_errored: 0,
        },
      ],
      details: [],
    };

    // Should not throw
    printSummaryTable(report);
  });

  test("handles null confidence correlation", () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: ["gemini/test"],
        total_items: 1,
      },
      search_metrics: emptySearchMetrics,
      summary: [
        {
          model: "gemini/test",
          mae: 10.5,
          mape: 0.15,
          coverage_rate: 0.8,
          avg_cost_usd: null,
          confidence_correlation: null,
          items_evaluated: 10,
          items_errored: 0,
        },
      ],
      details: [],
    };

    printSummaryTable(report);
  });

  test("handles empty summary", () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: [],
        total_items: 0,
      },
      search_metrics: emptySearchMetrics,
      summary: [],
      details: [],
    };

    printSummaryTable(report);
  });
});

describe("printSearchMetrics", () => {
  test("prints without crashing", () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: [],
        total_items: 3,
      },
      search_metrics: {
        total_items: 3,
        hit_rate: 0.667,
        items_with_comps: 2,
        items_without_comps: 1,
        strategy_distribution: { upc: 1, llm: 1, "llm-broad": 0, "llm-relaxed": 0, none: 1 },
      },
      summary: [],
      details: [],
    };
    printSearchMetrics(report);
  });
});

describe("computeSearchMetrics", () => {
  test("computes hit rate from ebay_sold_count", () => {
    const items = [
      { lot_id: 1, product_name: "A", upc: null, condition: "New", retail_price: 100, category: null, description: null, ebay_sold_median: 80, ebay_sold_count: 10, ebay_search_query: "upc:123", true_value: 50 },
      { lot_id: 2, product_name: "B", upc: null, condition: "New", retail_price: 50, category: null, description: null, ebay_sold_median: 0, ebay_sold_count: 0, ebay_search_query: null, true_value: 25 },
      { lot_id: 3, product_name: "C", upc: null, condition: "New", retail_price: 200, category: null, description: null, ebay_sold_median: 150, ebay_sold_count: 7, ebay_search_query: "llm:Brand Model", true_value: 100 },
    ];
    const metrics = computeSearchMetrics(items);
    expect(metrics.total_items).toBe(3);
    expect(metrics.items_with_comps).toBe(2);
    expect(metrics.items_without_comps).toBe(1);
    expect(metrics.hit_rate).toBeCloseTo(0.667, 2);
  });

  test("tracks strategy distribution", () => {
    const items = [
      { lot_id: 1, product_name: "A", upc: null, condition: "New", retail_price: 100, category: null, description: null, ebay_sold_median: 80, ebay_sold_count: 10, ebay_search_query: "upc:123", true_value: 50 },
      { lot_id: 2, product_name: "B", upc: null, condition: "New", retail_price: 50, category: null, description: null, ebay_sold_median: 40, ebay_sold_count: 6, ebay_search_query: "llm:Brand X", true_value: 25 },
      { lot_id: 3, product_name: "C", upc: null, condition: "New", retail_price: 200, category: null, description: null, ebay_sold_median: 0, ebay_sold_count: 0, ebay_search_query: null, true_value: 100 },
      { lot_id: 4, product_name: "D", upc: null, condition: "New", retail_price: 300, category: null, description: null, ebay_sold_median: 250, ebay_sold_count: 3, ebay_search_query: "llm-relaxed:Brand", true_value: 200 },
      { lot_id: 5, product_name: "E", upc: null, condition: "New", retail_price: 100, category: null, description: null, ebay_sold_median: 70, ebay_sold_count: 8, ebay_search_query: "llm-broad:Brand", true_value: 60 },
    ];
    const metrics = computeSearchMetrics(items);
    expect(metrics.strategy_distribution).toEqual({
      upc: 1,
      llm: 1,
      "llm-broad": 1,
      "llm-relaxed": 1,
      none: 1,
    });
  });

  test("handles empty items", () => {
    const metrics = computeSearchMetrics([]);
    expect(metrics.total_items).toBe(0);
    expect(metrics.hit_rate).toBe(0);
    expect(metrics.items_with_comps).toBe(0);
  });

  test("respects custom minComps threshold", () => {
    const items = [
      { lot_id: 1, product_name: "A", upc: null, condition: "New", retail_price: 100, category: null, description: null, ebay_sold_median: 80, ebay_sold_count: 3, ebay_search_query: "upc:123", true_value: 50 },
    ];
    // With default minComps=5, 3 comps is insufficient
    expect(computeSearchMetrics(items).items_with_comps).toBe(0);
    // With minComps=3, 3 comps is sufficient
    expect(computeSearchMetrics(items, 3).items_with_comps).toBe(1);
  });
});
