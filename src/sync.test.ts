import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openDatabase, upsertAnalyzedItem, getItemByLotId } from "./db";
import type { AnalyzedItem } from "./db";
import type { Database } from "bun:sqlite";
import { syncLiveData } from "./sync";

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
    image_flags: null,
    image_risk_score: null,
    image_analysis_skipped: null,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-24T12:00:00Z",
    analysis_source: "ebay",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

let db: Database;
let dbDir: string;

beforeEach(() => {
  dbDir = join(tmpdir(), `sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dbDir, { recursive: true });
  db = openDatabase(dbDir);
});

afterEach(() => {
  db.close();
  const actualPath = join(dbDir, "data.db");
  if (existsSync(actualPath)) {
    unlinkSync(actualPath);
  }
  restoreFetch();
});

describe("syncLiveData", () => {
  test("returns empty result when no open items", async () => {
    const { items, result } = await syncLiveData(db);
    expect(items).toEqual([]);
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.closed).toBe(0);
  });

  test("syncs live data for open items", async () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 111, current_bid: 10 }));
    upsertAnalyzedItem(db, makeItem({ lot_id: 222, current_bid: 20 }));

    mockFetch((url) => {
      const urlStr = String(url);
      if (urlStr.includes("/111")) {
        return Promise.resolve(new Response(JSON.stringify({
          current_bid: "75",
          total_bids: "5",
          watchers_count: 15,
          is_open: true,
        })));
      }
      if (urlStr.includes("/222")) {
        return Promise.resolve(new Response(JSON.stringify({
          current_bid: "200",
          total_bids: "12",
          watchers_count: 8,
          is_open: true,
        })));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });

    const { result } = await syncLiveData(db);

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.closed).toBe(0);

    const item111 = getItemByLotId(db, 111)!;
    expect(item111.current_bid).toBe(75);
    expect(item111.total_bids).toBe(5);
    expect(item111.watchers_count).toBe(15);
    expect(item111.live_updated_at).not.toBeNull();

    const item222 = getItemByLotId(db, 222)!;
    expect(item222.current_bid).toBe(200);
    expect(item222.total_bids).toBe(12);
  });

  test("marks items as closed when API reports is_open=false", async () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 333 }));

    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({
        current_bid: "100",
        total_bids: "8",
        watchers_count: 3,
        is_open: false,
      })))
    );

    const { items, result } = await syncLiveData(db);

    expect(result.synced).toBe(1);
    expect(result.closed).toBe(1);

    const item = getItemByLotId(db, 333)!;
    expect(item.is_open).toBe(0);

    // Closed items should not appear in refreshed open items
    expect(items.length).toBe(0);
  });

  test("counts failed fetches without stopping", async () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 444 }));
    upsertAnalyzedItem(db, makeItem({ lot_id: 555 }));

    mockFetch((url) => {
      const urlStr = String(url);
      if (urlStr.includes("/444")) {
        return Promise.resolve(new Response("server error", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        current_bid: "30",
        total_bids: "2",
        watchers_count: 5,
        is_open: true,
      })));
    });

    const { result } = await syncLiveData(db);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
  });

  test("handles fetch exceptions gracefully", async () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 666 }));

    mockFetch(() => Promise.reject(new Error("network error")));

    const { result } = await syncLiveData(db);

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
  });

  test("recalculates deal_score on sync", async () => {
    upsertAnalyzedItem(db, makeItem({
      lot_id: 777,
      recommended_max_bid: 100,
      current_bid: 10,
      deal_score: 90,
    }));

    mockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({
        current_bid: "80",
        total_bids: "10",
        watchers_count: 5,
        is_open: true,
      })))
    );

    await syncLiveData(db);

    const item = getItemByLotId(db, 777)!;
    // deal_score = (100 - 80) / 100 * 100 = 20
    expect(item.deal_score).toBe(20);
  });

  test("does not sync closed items", async () => {
    upsertAnalyzedItem(db, makeItem({ lot_id: 888, is_open: 0 }));

    let fetchCalled = false;
    mockFetch(() => {
      fetchCalled = true;
      return Promise.resolve(new Response(JSON.stringify({})));
    });

    const { result } = await syncLiveData(db);

    expect(result.synced).toBe(0);
    expect(fetchCalled).toBe(false);
  });
});
