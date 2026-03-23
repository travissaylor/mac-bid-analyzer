import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { fetchLotLiveData, updateOpenItems } from "./live-update";
import { openDatabase, upsertAnalyzedItem, getItemByLotId } from "./db";
import type { AnalyzedItem } from "./db";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function makeAnalyzedItem(lotId: number, overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    lot_id: lotId,
    auction_id: 100,
    lot_number: "A1",
    product_name: `Product ${lotId}`,
    upc: "012345678901",
    condition: "NEW",
    retail_price: 100,
    category: "Electronics",
    description: "A test product",
    image_url: null,
    building_id: 15,
    location_id: 1,
    auction_location: "Pittsburgh",
    expected_close_date: "2026-04-01T00:00:00Z",
    is_open: 1,
    current_bid: 5,
    total_bids: 2,
    watchers_count: 3,
    live_updated_at: null,
    ebay_sold_median: 50,
    ebay_sold_low: 30,
    ebay_sold_high: 70,
    ebay_sold_count: 6,
    ebay_search_query: "test query",
    llm_estimate_low: null,
    llm_estimate_mid: null,
    llm_estimate_high: null,
    llm_provider: null,
    llm_confidence: null,
    llm_reasoning: null,
    llm_comparables: null,
    recommended_max_bid: 20,
    sales_tax_rate: 0.07,
    location_cost: 0,
    location_tier: "home",
    deal_score: 75,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: new Date().toISOString(),
    analysis_source: "ebay",
    ...overrides,
  };
}

describe("live-update", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "macbid-live-test-"));
  });

  afterEach(() => {
    restoreFetch();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("fetchLotLiveData", () => {
    it("should fetch and parse live data", async () => {
      mockFetch(async (_url: string) => {
        return new Response(JSON.stringify({
          current_bid: 15.5,
          total_bids: 8,
          watchers_count: 12,
          is_open: true,
        }));
      });

      const result = await fetchLotLiveData(1001);
      expect(result.current_bid).toBe(15.5);
      expect(result.total_bids).toBe(8);
      expect(result.watchers_count).toBe(12);
      expect(result.is_open).toBe(true);
    });

    it("should handle closed auction", async () => {
      mockFetch(async (_url: string) => {
        return new Response(JSON.stringify({
          current_bid: 42,
          total_bids: 15,
          watchers_count: 5,
          is_open: false,
        }));
      });

      const result = await fetchLotLiveData(1001);
      expect(result.is_open).toBe(false);
      expect(result.current_bid).toBe(42);
    });

    it("should throw on non-OK response", async () => {
      mockFetch(async (_url: string) => new Response("Not found", { status: 404 }));
      await expect(fetchLotLiveData(9999)).rejects.toThrow("Failed to fetch live data for lot 9999");
    });

    it("should default missing fields", async () => {
      mockFetch(async (_url: string) => {
        return new Response(JSON.stringify({}));
      });

      const result = await fetchLotLiveData(1001);
      expect(result.current_bid).toBe(0);
      expect(result.total_bids).toBe(0);
      expect(result.watchers_count).toBe(0);
      expect(result.is_open).toBe(true);
    });
  });

  describe("updateOpenItems", () => {
    it("should update live data for open items", async () => {
      const db = openDatabase(tmpDir);
      upsertAnalyzedItem(db, makeAnalyzedItem(7001, { is_open: 1, current_bid: 5, recommended_max_bid: 20 }));
      upsertAnalyzedItem(db, makeAnalyzedItem(7002, { is_open: 1, current_bid: 10, recommended_max_bid: 30 }));
      db.close();

      mockFetch(async (url: string) => {
        if (url.includes("/7001")) {
          return new Response(JSON.stringify({ current_bid: 12, total_bids: 5, watchers_count: 8, is_open: true }));
        }
        if (url.includes("/7002")) {
          return new Response(JSON.stringify({ current_bid: 18, total_bids: 9, watchers_count: 4, is_open: true }));
        }
        return new Response("Not found", { status: 404 });
      });

      const summary = await updateOpenItems(tmpDir);
      expect(summary.total).toBe(2);
      expect(summary.updated).toBe(2);
      expect(summary.closed).toBe(0);
      expect(summary.errors).toBe(0);

      const db2 = openDatabase(tmpDir);
      const item1 = getItemByLotId(db2, 7001);
      expect(item1!.current_bid).toBe(12);
      expect(item1!.total_bids).toBe(5);
      expect(item1!.watchers_count).toBe(8);
      expect(item1!.live_updated_at).not.toBeNull();
      expect(item1!.deal_score).toBeCloseTo(40, 0);

      const item2 = getItemByLotId(db2, 7002);
      expect(item2!.current_bid).toBe(18);
      expect(item2!.deal_score).toBeCloseTo(40, 0);
      db2.close();
    });

    it("should mark closed items", async () => {
      const db = openDatabase(tmpDir);
      upsertAnalyzedItem(db, makeAnalyzedItem(8001, { is_open: 1, current_bid: 5 }));
      db.close();

      mockFetch(async (_url: string) => {
        return new Response(JSON.stringify({ current_bid: 25, total_bids: 12, watchers_count: 0, is_open: false }));
      });

      const summary = await updateOpenItems(tmpDir);
      expect(summary.updated).toBe(1);
      expect(summary.closed).toBe(1);

      const db2 = openDatabase(tmpDir);
      const item = getItemByLotId(db2, 8001);
      expect(item!.is_open).toBe(0);
      expect(item!.current_bid).toBe(25);
      db2.close();
    });

    it("should skip closed items in DB", async () => {
      const db = openDatabase(tmpDir);
      upsertAnalyzedItem(db, makeAnalyzedItem(9001, { is_open: 0 }));
      db.close();

      mockFetch(async (_url: string) => {
        throw new Error("Should not be called");
      });

      const summary = await updateOpenItems(tmpDir);
      expect(summary.total).toBe(0);
      expect(summary.updated).toBe(0);
    });

    it("should handle fetch errors gracefully", async () => {
      const db = openDatabase(tmpDir);
      upsertAnalyzedItem(db, makeAnalyzedItem(10001, { is_open: 1 }));
      upsertAnalyzedItem(db, makeAnalyzedItem(10002, { is_open: 1 }));
      db.close();

      mockFetch(async (url: string) => {
        if (url.includes("/10001")) {
          return new Response("Server Error", { status: 500 });
        }
        return new Response(JSON.stringify({ current_bid: 15, total_bids: 5, watchers_count: 3, is_open: true }));
      });

      const summary = await updateOpenItems(tmpDir);
      expect(summary.total).toBe(2);
      expect(summary.updated).toBe(1);
      expect(summary.errors).toBe(1);
    });

    it("should handle empty open items", async () => {
      const db = openDatabase(tmpDir);
      db.close();

      const summary = await updateOpenItems(tmpDir);
      expect(summary.total).toBe(0);
      expect(summary.updated).toBe(0);
      expect(summary.closed).toBe(0);
      expect(summary.errors).toBe(0);
    });

    it("should recalculate deal_score with updated bid", async () => {
      const db = openDatabase(tmpDir);
      upsertAnalyzedItem(db, makeAnalyzedItem(11001, {
        is_open: 1,
        current_bid: 5,
        recommended_max_bid: 40,
        deal_score: 87.5,
      }));
      db.close();

      mockFetch(async (_url: string) => {
        return new Response(JSON.stringify({ current_bid: 30, total_bids: 10, watchers_count: 2, is_open: true }));
      });

      await updateOpenItems(tmpDir);

      const db2 = openDatabase(tmpDir);
      const item = getItemByLotId(db2, 11001);
      // deal_score = (40 - 30) / 40 * 100 = 25
      expect(item!.deal_score).toBeCloseTo(25, 0);
      db2.close();
    });
  });
});
