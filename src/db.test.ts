import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  openDatabase,
  upsertAnalyzedItem,
  getItemByLotId,
  getOpenItems,
  updateLiveData,
} from "./db";
import type { AnalyzedItem } from "./db";

function makeItem(overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    lot_id: 12345,
    auction_id: 100,
    lot_number: "A-001",
    product_name: "MacBook Pro 14",
    upc: "123456789012",
    condition: "NEW",
    retail_price: 1999.99,
    category: "Laptops",
    description: "A laptop",
    image_url: "https://example.com/img.jpg",
    building_id: 15,
    location_id: 1,
    auction_location: "Pittsburgh",
    expected_close_date: "2026-03-25T12:00:00Z",
    is_open: 1,
    current_bid: 50,
    total_bids: 3,
    watchers_count: 10,
    live_updated_at: null,
    ebay_sold_median: 1400,
    ebay_sold_low: 1200,
    ebay_sold_high: 1600,
    ebay_sold_count: 12,
    ebay_search_query: "MacBook Pro 14",
    llm_estimate_low: null,
    llm_estimate_mid: null,
    llm_estimate_high: null,
    llm_provider: null,
    llm_confidence: null,
    llm_reasoning: null,
    llm_comparables: null,
    recommended_max_bid: 700,
    sales_tax_rate: 0.06,
    location_cost: 0,
    location_tier: "home",
    deal_score: 92.86,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "ebay",
    ...overrides,
  };
}

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `mac-bid-test-${Date.now()}`);
  require("fs").mkdirSync(testDir, { recursive: true });
  db = openDatabase(testDir);
});

afterEach(() => {
  db.close();
  const dbPath = join(testDir, "data.db");
  if (existsSync(dbPath)) unlinkSync(dbPath);
});

describe("openDatabase", () => {
  test("creates database file and tables", () => {
    const dbPath = join(testDir, "data.db");
    expect(existsSync(dbPath)).toBe(true);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("analyzed_items");
  });

  test("creates indexes", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_analyzed_items_is_open");
    expect(indexNames).toContain("idx_analyzed_items_auction_id");
    expect(indexNames).toContain("idx_analyzed_items_category");
    expect(indexNames).toContain("idx_analyzed_items_condition");
    expect(indexNames).toContain("idx_analyzed_items_deal_score");
  });
});

describe("upsertAnalyzedItem", () => {
  test("inserts a new item", () => {
    const item = makeItem();
    upsertAnalyzedItem(db, item);
    const result = getItemByLotId(db, 12345);
    expect(result).not.toBeNull();
    expect(result!.product_name).toBe("MacBook Pro 14");
    expect(result!.ebay_sold_median).toBe(1400);
    expect(result!.recommended_max_bid).toBe(700);
  });

  test("upserts an existing item", () => {
    upsertAnalyzedItem(db, makeItem());
    upsertAnalyzedItem(db, makeItem({ product_name: "MacBook Pro 16", recommended_max_bid: 800 }));
    const result = getItemByLotId(db, 12345);
    expect(result!.product_name).toBe("MacBook Pro 16");
    expect(result!.recommended_max_bid).toBe(800);
  });
});

describe("getItemByLotId", () => {
  test("returns null for non-existent item", () => {
    expect(getItemByLotId(db, 99999)).toBeNull();
  });
});

describe("getOpenItems", () => {
  test("returns only open items", () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 1, is_open: 1 }));
    upsertAnalyzedItem(db, makeItem({ lot_id: 2, is_open: 0 }));
    upsertAnalyzedItem(db, makeItem({ lot_id: 3, is_open: 1 }));
    const open = getOpenItems(db);
    expect(open.length).toBe(2);
    expect(open.map((i) => i.lot_id).sort()).toEqual([1, 3]);
  });
});

describe("updateLiveData", () => {
  test("updates live fields and recalculates deal score", () => {
    upsertAnalyzedItem(db, makeItem({ recommended_max_bid: 100 }));
    updateLiveData(db, 12345, { current_bid: 30, total_bids: 5, watchers_count: 20, is_open: 1 });
    const result = getItemByLotId(db, 12345)!;
    expect(result.current_bid).toBe(30);
    expect(result.total_bids).toBe(5);
    expect(result.watchers_count).toBe(20);
    expect(result.live_updated_at).not.toBeNull();
    expect(result.deal_score).toBeCloseTo(70, 0);
  });

  test("sets deal_score null when no recommended_max_bid", () => {
    upsertAnalyzedItem(db, makeItem({ recommended_max_bid: null }));
    updateLiveData(db, 12345, { current_bid: 30, total_bids: 5, watchers_count: 20, is_open: 1 });
    const result = getItemByLotId(db, 12345)!;
    expect(result.deal_score).toBeNull();
  });

  test("marks item as closed", () => {
    upsertAnalyzedItem(db, makeItem());
    updateLiveData(db, 12345, { current_bid: 100, total_bids: 10, watchers_count: 5, is_open: 0 });
    const result = getItemByLotId(db, 12345)!;
    expect(result.is_open).toBe(0);
  });
});

