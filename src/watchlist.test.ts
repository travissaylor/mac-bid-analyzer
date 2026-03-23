import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { fetchWatchlist, runWatchlist, printWatchlistSummary } from "./watchlist";
import { openDatabase, getItemByLotId } from "./db";
import type { AppConfig } from "./config";
import { clearBuildingsCache } from "./location";
import { clearTokenCache } from "./ebay";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    home_building_ids: [15, 16],
    discount_threshold: 0.3,
    lot_fee: 3.0,
    buyers_premium_rate: 0.15,
    min_ebay_comps: 5,
    location_tiers: {
      transfer: { extra_cost: 10 },
      remote: { extra_cost: 25 },
    },
    manual_review_conditions: ["USED", "SALVAGE", "DAMAGED"],
    circuit_breaker_threshold: 5,
    gemini_model: "gemini-2.5-flash",
    env: {
      macbidEmail: "test@test.com",
      macbidPassword: "password123",
      ebayAppId: "test-app-id",
      ebayAppSecret: "test-secret",
      geminiApiKey: "",
      ntfyUrl: "",
    },
    cli: {},
    ...overrides,
  };
}

function makeWatchlistResponse(items: Array<{ id: number; product_name: string }>) {
  return { watchlist_full: items };
}

function makeLotResponse(lotId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: lotId,
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
    current_location_id: 1,
    location: "Pittsburgh",
    expected_close_date: "2026-04-01T00:00:00Z",
    is_open: true,
    current_bid: 5,
    total_bids: 2,
    watchers_count: 3,
    ...overrides,
  };
}

function makeEbayTokenResponse() {
  return { access_token: "test-token", expires_in: 7200 };
}

function makeEbaySearchResponse(count: number, median: number) {
  const items = Array.from({ length: count }, (_, i) => ({
    itemId: `item-${i}`,
    title: "Test Item",
    price: { value: String(median + (i - Math.floor(count / 2)) * 5), currency: "USD" },
    condition: "New",
    itemEndDate: "2026-03-20T00:00:00Z",
  }));

  return {
    itemSummaries: items,
    total: count,
  };
}

function makeFirebaseSignInResponse() {
  return {
    idToken: "test-firebase-id-token",
    refreshToken: "test-refresh-token",
    expiresIn: "3600",
  };
}

function makeBuildingsResponse() {
  return [
    { id: 15, tax_rate: 0.07, transfer_destinations: [16] },
    { id: 16, tax_rate: 0.06, transfer_destinations: [15] },
  ];
}

describe("watchlist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "macbid-test-"));
    clearBuildingsCache();
    clearTokenCache();
  });

  afterEach(() => {
    restoreFetch();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("fetchWatchlist", () => {
    it("should fetch and parse watchlist items", async () => {
      mockFetch(async (url: string, init?: RequestInit) => {
        if (url.includes("/user/me")) {
          expect(init?.headers).toEqual({ Authorization: "test-token" });
          return new Response(JSON.stringify(makeWatchlistResponse([
            { id: 1001, product_name: "iPhone 15" },
            { id: 1002, product_name: "MacBook Pro" },
          ])));
        }
        return new Response("Not found", { status: 404 });
      });

      const items = await fetchWatchlist("test-token");
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(1001);
      expect(items[0].product_name).toBe("iPhone 15");
      expect(items[1].id).toBe(1002);
    });

    it("should throw on non-OK response", async () => {
      mockFetch(async (_url: string) => new Response("Unauthorized", { status: 401 }));
      await expect(fetchWatchlist("bad-token")).rejects.toThrow("Failed to fetch watchlist: 401");
    });

    it("should throw when watchlist_full is missing", async () => {
      mockFetch(async (_url: string) => new Response(JSON.stringify({ user: "test" })));
      await expect(fetchWatchlist("token")).rejects.toThrow("watchlist_full is missing");
    });

    it("should handle empty watchlist", async () => {
      mockFetch(async (_url: string) => new Response(JSON.stringify(makeWatchlistResponse([]))));
      const items = await fetchWatchlist("token");
      expect(items).toHaveLength(0);
    });
  });

  describe("runWatchlist", () => {
    function setupMockFetch(watchlistItems: Array<{ id: number; product_name: string }>, ebayCount = 6) {
      mockFetch(async (url: string) => {
        // Firebase sign-in
        if (url.includes("identitytoolkit.googleapis.com")) {
          return new Response(JSON.stringify(makeFirebaseSignInResponse()));
        }
        // User/me watchlist
        if (url.includes("/user/me")) {
          return new Response(JSON.stringify(makeWatchlistResponse(watchlistItems)));
        }
        // Lot fetch
        const lotMatch = url.match(/\/lot\/(\d+)$/);
        if (lotMatch) {
          const lotId = parseInt(lotMatch[1], 10);
          return new Response(JSON.stringify(makeLotResponse(lotId)));
        }
        // Buildings
        if (url.includes("/buildings")) {
          return new Response(JSON.stringify(makeBuildingsResponse()));
        }
        // eBay token
        if (url.includes("oauth2/token")) {
          return new Response(JSON.stringify(makeEbayTokenResponse()));
        }
        // eBay search
        if (url.includes("buy/browse")) {
          return new Response(JSON.stringify(makeEbaySearchResponse(ebayCount, 50)));
        }
        return new Response("Not found", { status: 404 });
      });
    }

    it("should analyze new watchlist items", async () => {
      setupMockFetch([
        { id: 2001, product_name: "iPad Air" },
        { id: 2002, product_name: "AirPods Pro" },
      ]);

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const summary = await runWatchlist(config);
        expect(summary.total).toBe(2);
        expect(summary.analyzed).toBe(2);
        expect(summary.skipped).toBe(0);
        expect(summary.errors).toBe(0);

        // Verify items are in DB
        const db = openDatabase();
        try {
          expect(getItemByLotId(db, 2001)).not.toBeNull();
          expect(getItemByLotId(db, 2002)).not.toBeNull();
        } finally {
          db.close();
        }
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should skip already-analyzed items", async () => {
      setupMockFetch([
        { id: 3001, product_name: "MacBook Air" },
        { id: 3002, product_name: "Mac Mini" },
      ]);

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        // First run: analyze all
        await runWatchlist(config);

        // Reset fetch mocks (token cache cleared, need fresh mocks)
        clearTokenCache();
        setupMockFetch([
          { id: 3001, product_name: "MacBook Air" },
          { id: 3002, product_name: "Mac Mini" },
          { id: 3003, product_name: "iMac" },
        ]);

        // Second run: should skip 3001 and 3002, analyze 3003
        const summary = await runWatchlist(config);
        expect(summary.total).toBe(3);
        expect(summary.analyzed).toBe(1);
        expect(summary.skipped).toBe(2);
        expect(summary.errors).toBe(0);
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should re-analyze all items with --force", async () => {
      setupMockFetch([
        { id: 4001, product_name: "Apple Watch" },
      ]);

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        // First run
        await runWatchlist(config);

        clearTokenCache();
        setupMockFetch([{ id: 4001, product_name: "Apple Watch" }]);

        // Second run with force
        const summary = await runWatchlist(config, { force: true });
        expect(summary.total).toBe(1);
        expect(summary.analyzed).toBe(1);
        expect(summary.skipped).toBe(0);
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should list items without analyzing in dry-run mode", async () => {
      setupMockFetch([
        { id: 5001, product_name: "HomePod" },
        { id: 5002, product_name: "Apple TV" },
      ]);

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const summary = await runWatchlist(config, { dryRun: true });
        expect(summary.total).toBe(2);
        expect(summary.analyzed).toBe(0);
        expect(summary.skipped).toBe(0);

        // Verify nothing was written to DB
        const db = openDatabase();
        try {
          expect(getItemByLotId(db, 5001)).toBeNull();
          expect(getItemByLotId(db, 5002)).toBeNull();
        } finally {
          db.close();
        }
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should handle empty watchlist", async () => {
      setupMockFetch([]);

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const summary = await runWatchlist(config);
        expect(summary.total).toBe(0);
        expect(summary.analyzed).toBe(0);
        expect(summary.skipped).toBe(0);
        expect(summary.errors).toBe(0);
      } finally {
        process.chdir(origCwd);
      }
    });

    it("should count errors for failed items and continue", async () => {
      mockFetch(async (url: string) => {
        if (url.includes("identitytoolkit.googleapis.com")) {
          return new Response(JSON.stringify(makeFirebaseSignInResponse()));
        }
        if (url.includes("/user/me")) {
          return new Response(JSON.stringify(makeWatchlistResponse([
            { id: 6001, product_name: "Good Item" },
            { id: 6002, product_name: "Bad Item" },
          ])));
        }
        const lotMatch = url.match(/\/lot\/(\d+)$/);
        if (lotMatch) {
          const lotId = parseInt(lotMatch[1], 10);
          if (lotId === 6002) {
            return new Response("Server Error", { status: 500 });
          }
          return new Response(JSON.stringify(makeLotResponse(lotId)));
        }
        if (url.includes("/buildings")) {
          return new Response(JSON.stringify(makeBuildingsResponse()));
        }
        if (url.includes("oauth2/token")) {
          return new Response(JSON.stringify(makeEbayTokenResponse()));
        }
        if (url.includes("buy/browse")) {
          return new Response(JSON.stringify(makeEbaySearchResponse(6, 50)));
        }
        return new Response("Not found", { status: 404 });
      });

      const config = makeConfig();
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const summary = await runWatchlist(config);
        expect(summary.total).toBe(2);
        expect(summary.analyzed).toBe(1);
        expect(summary.errors).toBe(1);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("printWatchlistSummary", () => {
    it("should print summary without throwing", () => {
      // Just verify it doesn't throw
      printWatchlistSummary({ total: 10, analyzed: 7, skipped: 2, errors: 1, liveUpdated: 5, liveClosed: 1, liveErrors: 0, circuitBreakerTripped: false });
    });
  });
});
