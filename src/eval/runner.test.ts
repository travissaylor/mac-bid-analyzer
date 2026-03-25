import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runEval, saveReport, printSummaryTable } from "./runner";
import type { EvalReport } from "./runner";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DIR = "test-runner-tmp";
const FIXTURE_FILE = `${TEST_DIR}/fixtures.jsonl`;

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

describe("printSummaryTable", () => {
  test("prints table without crashing", () => {
    const report: EvalReport = {
      metadata: {
        run_at: "2025-01-01T00:00:00Z",
        fixture_path: "test.jsonl",
        models: ["gemini/test"],
        total_items: 1,
      },
      summary: [
        {
          model: "gemini/test",
          mae: 10.5,
          mape: 0.15,
          coverage_rate: 0.8,
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
      summary: [
        {
          model: "gemini/test",
          mae: 10.5,
          mape: 0.15,
          coverage_rate: 0.8,
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
      summary: [],
      details: [],
    };

    printSummaryTable(report);
  });
});
