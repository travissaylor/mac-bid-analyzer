import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadFixtures } from "./fixtures";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DIR = "test-fixtures-tmp";
const TEST_FILE = `${TEST_DIR}/test.jsonl`;

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
    true_value: null,
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

describe("loadFixtures", () => {
  test("skips items with null true_value", async () => {
    const lines = [
      makeFixtureLine({ lot_id: 1, true_value: null }),
      makeFixtureLine({ lot_id: 2, true_value: 150 }),
      makeFixtureLine({ lot_id: 3, true_value: null }),
    ];
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated).toHaveLength(1);
    expect(result.annotated[0].lot_id).toBe(2);
    expect(result.annotated[0].true_value).toBe(150);
    expect(result.skipped).toBe(2);
  });

  test("warns when fewer than 5 annotated items", async () => {
    const lines = [
      makeFixtureLine({ lot_id: 1, true_value: 100 }),
      makeFixtureLine({ lot_id: 2, true_value: 200 }),
    ];
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Only 2 item(s)");
    expect(result.warnings[0]).toContain("At least 5 recommended");
  });

  test("no warning when 5 or more annotated items", async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeFixtureLine({ lot_id: i + 1, true_value: (i + 1) * 100 }),
    );
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated).toHaveLength(5);
    expect(result.warnings).toHaveLength(0);
  });

  test("throws on missing fixture file", async () => {
    await expect(loadFixtures("nonexistent.jsonl")).rejects.toThrow(
      "Fixture file not found",
    );
  });

  test("throws on empty fixture file", async () => {
    await Bun.write(TEST_FILE, "");
    await expect(loadFixtures(TEST_FILE)).rejects.toThrow(
      "Fixture file is empty",
    );
  });

  test("throws on invalid JSON", async () => {
    await Bun.write(TEST_FILE, "not json\n");
    await expect(loadFixtures(TEST_FILE)).rejects.toThrow(
      "Invalid JSON on line 1",
    );
  });

  test("handles true_value of 0", async () => {
    const lines = [makeFixtureLine({ lot_id: 1, true_value: 0 })];
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated).toHaveLength(1);
    expect(result.annotated[0].true_value).toBe(0);
  });

  test("ignores blank lines", async () => {
    const lines = [
      makeFixtureLine({ lot_id: 1, true_value: 100 }),
      "",
      makeFixtureLine({ lot_id: 2, true_value: 200 }),
      "  ",
    ];
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated).toHaveLength(2);
  });

  test("returns all annotated items in order", async () => {
    const lines = [
      makeFixtureLine({ lot_id: 1, true_value: null }),
      makeFixtureLine({ lot_id: 2, true_value: 200 }),
      makeFixtureLine({ lot_id: 3, true_value: null }),
      makeFixtureLine({ lot_id: 4, true_value: 400 }),
      makeFixtureLine({ lot_id: 5, true_value: 500 }),
    ];
    await Bun.write(TEST_FILE, lines.join("\n") + "\n");

    const result = await loadFixtures(TEST_FILE);
    expect(result.annotated.map((i) => i.lot_id)).toEqual([2, 4, 5]);
    expect(result.skipped).toBe(2);
  });
});
