import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  parseLotId,
  isAsin,
  calculateMaxBid,
  calculateDealScore,
  blendEstimates,
  analyzeItem,
  fetchLotItem,
} from "./analyze";
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
    llm_model: "gemini/gemini-2.5-flash",
    env: {
      ebayAppId: "test-app-id",
      ebayAppSecret: "test-secret",
      geminiApiKey: "",
      openaiApiKey: "",
    },
    cli: {},
    ...overrides,
  };
}

describe("analyze", () => {
  describe("parseLotId", () => {
    it("should parse a bare numeric lot ID", () => {
      expect(parseLotId("12345")).toBe(12345);
    });

    it("should parse a bare numeric lot ID with whitespace", () => {
      expect(parseLotId("  12345  ")).toBe(12345);
    });

    it("should parse /lot/{id} permalink", () => {
      expect(parseLotId("/lot/67890")).toBe(67890);
    });

    it("should parse full URL with auction and lot", () => {
      expect(parseLotId("https://mac.bid/auction/abc-123/lot/99999")).toBe(99999);
    });

    it("should parse full URL with www prefix", () => {
      expect(parseLotId("https://www.mac.bid/auction/abc-123/lot/55555")).toBe(55555);
    });

    it("should parse https://mac.bid/lot/{id}", () => {
      expect(parseLotId("https://mac.bid/lot/44444")).toBe(44444);
    });

    it("should return URL string for alphanumeric lot numbers", () => {
      const result = parseLotId("https://www.mac.bid/auction/UNL2603-23-A1/lot/2587T");
      expect(typeof result).toBe("string");
      expect(result).toContain("mac.bid");
    });

    it("should throw for invalid input", () => {
      expect(() => parseLotId("not-a-url")).toThrow("Cannot parse lot ID");
    });

    it("should throw for empty input", () => {
      expect(() => parseLotId("")).toThrow("Cannot parse lot ID");
    });
  });

  describe("isAsin", () => {
    it("should detect ASINs starting with B0", () => {
      expect(isAsin("B0ABCD1234")).toBe(true);
    });

    it("should not detect real UPCs as ASINs", () => {
      expect(isAsin("012345678901")).toBe(false);
    });

    it("should not detect short strings as ASINs", () => {
      expect(isAsin("B0ABC")).toBe(false);
    });

    it("should not detect non-B0 10-char strings as ASINs", () => {
      expect(isAsin("A0ABCD1234")).toBe(false);
    });
  });

  describe("calculateMaxBid", () => {
    it("should calculate max bid correctly for home location", () => {
      // Example from PRICING.md: eBay median $55, tax 6%, home ($0 extra)
      // target = 55 * 0.7 = 38.50
      // max = (38.50 - 3.00 - 0) / (1 + 0.15 + 0.06) = 35.50 / 1.21 = 29.34
      const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 0);
      expect(result).toBeCloseTo(29.34, 1);
    });

    it("should calculate max bid correctly for transfer location", () => {
      // target = 55 * 0.7 = 38.50
      // max = (38.50 - 3.00 - 10.00) / 1.21 = 25.50 / 1.21 = 21.07
      const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 10);
      expect(result).toBeCloseTo(21.07, 1);
    });

    it("should calculate max bid correctly for remote location", () => {
      // target = 55 * 0.7 = 38.50
      // max = (38.50 - 3.00 - 25.00) / 1.21 = 10.50 / 1.21 = 8.68
      const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 25);
      expect(result).toBeCloseTo(8.68, 1);
    });

    it("should return negative when fees exceed target", () => {
      // Very low eBay price, high fees
      const result = calculateMaxBid(5.0, 0.3, 3.0, 0.15, 0.06, 25);
      expect(result).toBeLessThan(0);
    });

    it("should handle zero eBay median", () => {
      const result = calculateMaxBid(0, 0.3, 3.0, 0.15, 0.06, 0);
      expect(result).toBeLessThan(0);
    });
  });

  describe("blendEstimates", () => {
    it("should blend equally when AI confidence is 100 and eBay comps meet minimum", () => {
      // aiWeight = 100/100 = 1.0, ebayWeight = min(5/5, 1.0) = 1.0
      // blended = (50*1.0 + 60*1.0) / 2.0 = 55
      expect(blendEstimates(50, 100, 60, 5, 5)).toBeCloseTo(55, 2);
    });

    it("should weight eBay more when AI confidence is low", () => {
      // aiWeight = 30/100 = 0.3, ebayWeight = 1.0
      // blended = (50*0.3 + 60*1.0) / 1.3 = 75/1.3 = 57.69
      expect(blendEstimates(50, 30, 60, 5, 5)).toBeCloseTo(57.69, 1);
    });

    it("should weight AI more when eBay comps are below minimum", () => {
      // aiWeight = 80/100 = 0.8, ebayWeight = min(2/5, 1.0) = 0.4
      // blended = (50*0.8 + 60*0.4) / 1.2 = 64/1.2 = 53.33
      expect(blendEstimates(50, 80, 60, 2, 5)).toBeCloseTo(53.33, 1);
    });

    it("should cap eBay weight at 1.0 when comps exceed minimum", () => {
      // aiWeight = 0.5, ebayWeight = min(10/5, 1.0) = 1.0
      // blended = (50*0.5 + 60*1.0) / 1.5 = 85/1.5 = 56.67
      expect(blendEstimates(50, 50, 60, 10, 5)).toBeCloseTo(56.67, 1);
    });

    it("should return 0 when both weights are zero", () => {
      expect(blendEstimates(50, 0, 60, 0, 5)).toBe(0);
    });
  });

  describe("calculateDealScore", () => {
    it("should calculate positive deal score when bid is below max", () => {
      // max=30, bid=10 => (30-10)/30*100 = 66.67%
      expect(calculateDealScore(30, 10)).toBeCloseTo(66.67, 1);
    });

    it("should calculate negative deal score when bid exceeds max", () => {
      // max=20, bid=25 => (20-25)/20*100 = -25%
      expect(calculateDealScore(20, 25)).toBeCloseTo(-25, 1);
    });

    it("should return zero when max bid is zero", () => {
      expect(calculateDealScore(0, 10)).toBe(0);
    });

    it("should return zero when max bid is negative", () => {
      expect(calculateDealScore(-5, 10)).toBe(0);
    });

    it("should return 100% when current bid is 0", () => {
      expect(calculateDealScore(30, 0)).toBeCloseTo(100, 1);
    });
  });

  describe("fetchLotItem", () => {
    beforeEach(() => {
      restoreFetch();
    });

    afterEach(() => {
      restoreFetch();
    });

    it("should fetch and parse lot data", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("/map-bid/ddb/lot/12345");
        return new Response(JSON.stringify({
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Test Widget",
          upc: "012345678901",
          condition: "OPEN BOX",
          retail_price: 99.99,
          building_id: 15,
          current_bid: 5.00,
          is_open: true,
          total_bids: 3,
          watchers_count: 7,
        }));
      });

      const lot = await fetchLotItem(12345);
      expect(lot.id).toBe(12345);
      expect(lot.product_name).toBe("Test Widget");
      expect(lot.condition).toBe("OPEN BOX");
      expect(lot.current_bid).toBe(5.00);
      expect(lot.is_open).toBe(true);
    });

    it("should throw on non-OK response", async () => {
      mockFetch(async () => new Response("Not Found", { status: 404 }));
      expect(fetchLotItem(99999)).rejects.toThrow("Failed to fetch lot 99999");
    });
  });

  describe("analyzeItem", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "analyze-test-"));
      clearBuildingsCache();
      clearTokenCache();
      restoreFetch();
    });

    afterEach(() => {
      restoreFetch();
      clearBuildingsCache();
      clearTokenCache();
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    });

    function setupMocks(options: {
      lotData?: Record<string, unknown>;
      buildings?: unknown[];
      ebayToken?: boolean;
      ebayItems?: unknown[];
      geminiResponse?: Record<string, unknown>;
      geminiError?: boolean;
    } = {}) {
      const lotData = options.lotData ?? {
        id: 12345,
        auction_id: 100,
        lot_number: "42",
        product_name: "Ninja Blender NJ600",
        upc: "012345678901",
        condition: "OPEN BOX",
        retail_price: 79.99,
        building_id: 15,
        current_bid: 5.00,
        is_open: true,
        total_bids: 3,
        watchers_count: 7,
      };

      const buildings = options.buildings ?? [
        { id: 15, name: "Robinson", sales_tax: 0.06, transfer_destinations: "20,21" },
        { id: 16, name: "Monroeville", sales_tax: 0.06, transfer_destinations: "20" },
        { id: 20, name: "Columbus", sales_tax: 0.07, transfer_destinations: null },
      ];

      const ebayItems = options.ebayItems ?? [
        { price: { value: "50.00" } },
        { price: { value: "55.00" } },
        { price: { value: "52.00" } },
        { price: { value: "58.00" } },
        { price: { value: "60.00" } },
      ];

      mockFetch(async (url, _init) => {
        if (url.includes("/map-bid/ddb/lot/")) {
          return new Response(JSON.stringify(lotData));
        }
        if (url.includes("/buildings")) {
          return new Response(JSON.stringify(buildings));
        }
        if (url.includes("oauth2/token")) {
          return new Response(JSON.stringify({
            access_token: "test-token",
            expires_in: 7200,
          }));
        }
        if (url.includes("buy/browse")) {
          return new Response(JSON.stringify({
            total: ebayItems.length,
            itemSummaries: ebayItems,
          }));
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          if (options.geminiError) {
            return new Response("Service unavailable", { status: 503 });
          }
          const geminiResponse = options.geminiResponse ?? {
            candidates: [{
              content: {
                parts: [{ text: '{"low": 35.00, "mid": 50.00, "high": 65.00}' }],
              },
            }],
          };
          return new Response(JSON.stringify(geminiResponse));
        }
        return new Response("Unknown", { status: 404 });
      });
    }

    it("should analyze an item with sufficient eBay comps", async () => {
      setupMocks();
      const config = makeConfig();
      // Override openDatabase to use temp dir
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.skipped).toBe(false);
        expect(result.item.lot_id).toBe(12345);
        expect(result.item.product_name).toBe("Ninja Blender NJ600");
        expect(result.item.ebay_sold_count).toBe(5);
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.recommended_max_bid!).toBeGreaterThan(0);
        expect(result.item.location_tier).toBe("home");
        expect(result.item.location_cost).toBe(0);
        expect(result.item.needs_manual_review).toBe(0);
        expect(result.item.analysis_source).toBe("ebay");
        // No Gemini key → no LLM data
        expect(result.item.llm_provider).toBeNull();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should use blended source when both eBay comps and AI are available", async () => {
      setupMocks({
        geminiResponse: {
          candidates: [{
            content: {
              parts: [{ text: '{"low": 35.00, "mid": 50.00, "high": 65.00, "confidence": 80, "reasoning": "Good product", "comparables": []}' }],
            },
          }],
        },
      });
      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
            },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.skipped).toBe(false);
        expect(result.item.analysis_source).toBe("blended");
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.recommended_max_bid!).toBeGreaterThan(0);
        expect(result.item.llm_provider).toBe("gemini");
        expect(result.item.llm_estimate_mid).toBe(50.00);
        expect(result.item.llm_confidence).toBe(80);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should fall back to ebay source when AI has no confidence score", async () => {
      setupMocks();
      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
            },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.skipped).toBe(false);
        // No confidence in default mock response → falls back to ebay only
        expect(result.item.analysis_source).toBe("ebay");
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.llm_provider).toBe("gemini");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should flag USED condition for manual review", async () => {
      setupMocks({
        lotData: {
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Used Widget",
          upc: "012345678901",
          condition: "USED",
          building_id: 15,
          current_bid: 5.00,
          is_open: true,
          total_bids: 1,
          watchers_count: 2,
        },
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.needs_manual_review).toBe(1);
        expect(result.item.recommended_max_bid).toBeNull();
        expect(result.item.analysis_source).toBe("manual_review");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should use AI estimate directly when insufficient comps and API key set", async () => {
      setupMocks({
        ebayItems: [
          { price: { value: "50.00" } },
          { price: { value: "55.00" } },
        ],
      });
      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
            },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.needs_manual_review).toBe(0);
        // AI estimate is now used directly for max bid
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.recommended_max_bid!).toBeGreaterThan(0);
        expect(result.item.analysis_source).toBe("ai");
        expect(result.item.llm_provider).toBe("gemini");
        expect(result.item.llm_estimate_low).toBe(35.00);
        expect(result.item.llm_estimate_mid).toBe(50.00);
        expect(result.item.llm_estimate_high).toBe(65.00);
        expect(result.item.manual_review_reason).toBeNull();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should set analysis_source to none when Gemini fails and insufficient comps", async () => {
      setupMocks({
        ebayItems: [
          { price: { value: "50.00" } },
        ],
        geminiError: true,
      });
      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
            },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.needs_manual_review).toBe(1);
        expect(result.item.recommended_max_bid).toBeNull();
        expect(result.item.analysis_source).toBe("none");
        expect(result.item.llm_provider).toBeNull();
        expect(result.item.manual_review_reason).toContain("no AI estimate");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should pass eBay sold data to LLM when available", async () => {
      let capturedBody: string | null = null;
      const lotData = {
        id: 12345,
        auction_id: 100,
        lot_number: "42",
        product_name: "Ninja Blender NJ600",
        upc: "012345678901",
        condition: "OPEN BOX",
        retail_price: 79.99,
        building_id: 15,
        current_bid: 5.00,
        is_open: true,
        total_bids: 3,
        watchers_count: 7,
      };
      const buildings = [
        { id: 15, name: "Robinson", sales_tax: 0.06, transfer_destinations: "20,21" },
      ];
      const ebayItems = [
        { price: { value: "50.00" } },
        { price: { value: "55.00" } },
        { price: { value: "52.00" } },
        { price: { value: "58.00" } },
        { price: { value: "60.00" } },
      ];

      mockFetch(async (url, init) => {
        if (url.includes("/map-bid/ddb/lot/")) {
          return new Response(JSON.stringify(lotData));
        }
        if (url.includes("/buildings")) {
          return new Response(JSON.stringify(buildings));
        }
        if (url.includes("oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "test-token", expires_in: 7200 }));
        }
        if (url.includes("buy/browse")) {
          return new Response(JSON.stringify({ total: ebayItems.length, itemSummaries: ebayItems }));
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          capturedBody = typeof init?.body === "string" ? init.body : null;
          return new Response(JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: '{"low": 35.00, "mid": 50.00, "high": 65.00, "confidence": 80, "reasoning": "Good product", "comparables": []}' }],
              },
            }],
          }));
        }
        return new Response("Unknown", { status: 404 });
      });

      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
        },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.analysis_source).toBe("blended");
        // Verify that the prompt sent to Gemini included eBay sold data
        expect(capturedBody).not.toBeNull();
        expect(capturedBody!).toContain("eBay Sold Median");
        expect(capturedBody!).toContain("55"); // median of the 5 items
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should pass null eBay data to LLM when eBay search fails", async () => {
      let capturedBody: string | null = null;
      const lotData = {
        id: 12345,
        auction_id: 100,
        lot_number: "42",
        product_name: "Ninja Blender NJ600",
        upc: "012345678901",
        condition: "OPEN BOX",
        retail_price: 79.99,
        building_id: 15,
        current_bid: 5.00,
        is_open: true,
        total_bids: 3,
        watchers_count: 7,
      };
      const buildings = [
        { id: 15, name: "Robinson", sales_tax: 0.06, transfer_destinations: "20,21" },
      ];

      mockFetch(async (url, init) => {
        if (url.includes("/map-bid/ddb/lot/")) {
          return new Response(JSON.stringify(lotData));
        }
        if (url.includes("/buildings")) {
          return new Response(JSON.stringify(buildings));
        }
        if (url.includes("oauth2/token")) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          capturedBody = typeof init?.body === "string" ? init.body : null;
          return new Response(JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: '{"low": 25.00, "mid": 40.00, "high": 55.00, "confidence": 50, "reasoning": "No comps", "comparables": []}' }],
              },
            }],
          }));
        }
        return new Response("Unknown", { status: 404 });
      });

      const config = makeConfig({
        env: {
          ebayAppId: "test-app-id",
          ebayAppSecret: "test-secret",
          geminiApiKey: "test-gemini-key",
          openaiApiKey: "",
        },
      });
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        // eBay failed, so AI-only source
        expect(result.item.analysis_source).toBe("ai");
        // Verify prompt included "no completed sales" message
        expect(capturedBody).not.toBeNull();
        expect(capturedBody!).toContain("No completed sales found");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should set analysis_source to none when no Gemini API key and insufficient comps", async () => {
      setupMocks({
        ebayItems: [
          { price: { value: "50.00" } },
          { price: { value: "55.00" } },
        ],
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.needs_manual_review).toBe(1);
        expect(result.item.recommended_max_bid).toBeNull();
        expect(result.item.analysis_source).toBe("none");
        expect(result.item.manual_review_reason).toContain("no AI estimate");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should skip already-analyzed items without --force", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        // First analysis
        const first = await analyzeItem(12345, config);
        expect(first.skipped).toBe(false);

        // Reset mocks (buildings cache cleared)
        clearBuildingsCache();
        clearTokenCache();
        setupMocks();

        // Second analysis without force — should skip
        const second = await analyzeItem(12345, config);
        expect(second.skipped).toBe(true);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should re-analyze with --force flag", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        // First analysis
        await analyzeItem(12345, config);

        // Reset mocks
        clearBuildingsCache();
        clearTokenCache();
        setupMocks();

        // Second analysis with force
        const result = await analyzeItem(12345, config, { force: true });
        expect(result.skipped).toBe(false);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should not write to DB in dry-run mode", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config, { dryRun: true });
        expect(result.skipped).toBe(false);

        // Verify not stored in DB
        const db = openDatabase(tmpDir);
        try {
          const stored = getItemByLotId(db, 12345);
          expect(stored).toBeNull();
        } finally {
          db.close();
        }
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should handle transfer location tier", async () => {
      setupMocks({
        lotData: {
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Widget",
          upc: "012345678901",
          condition: "NEW",
          building_id: 20, // Columbus — transfer-eligible from home buildings
          current_bid: 5.00,
          is_open: true,
          total_bids: 1,
          watchers_count: 2,
        },
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.location_tier).toBe("transfer");
        expect(result.item.location_cost).toBe(10);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should handle remote location tier", async () => {
      setupMocks({
        lotData: {
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Widget",
          upc: "012345678901",
          condition: "NEW",
          building_id: 99, // Unknown building — remote
          current_bid: 5.00,
          is_open: true,
          total_bids: 1,
          watchers_count: 2,
        },
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.location_tier).toBe("remote");
        expect(result.item.location_cost).toBe(25);
      } finally {
        process.cwd = origCwd;
      }
    });

    it("should flag negative max bid as not worth it", async () => {
      // Very low eBay prices with remote location
      setupMocks({
        lotData: {
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Cheap Widget",
          upc: "012345678901",
          condition: "NEW",
          building_id: 99,
          current_bid: 1.00,
          is_open: true,
          total_bids: 1,
          watchers_count: 1,
        },
        ebayItems: [
          { price: { value: "10.00" } },
          { price: { value: "12.00" } },
          { price: { value: "11.00" } },
          { price: { value: "9.00" } },
          { price: { value: "13.00" } },
        ],
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config);
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.recommended_max_bid!).toBeLessThanOrEqual(0);
        expect(result.item.needs_manual_review).toBe(1);
        expect(result.item.manual_review_reason).toContain("not worth it");
      } finally {
        process.cwd = origCwd;
      }
    });
  });

});
