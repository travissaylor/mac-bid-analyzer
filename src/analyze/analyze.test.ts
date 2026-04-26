import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";

// Other test files in this process (src/llm/gemini.test.ts and
// src/llm/search-query.test.ts) install a sticky mock.module for
// "@google/genai" with a hard-coded response. That breaks the fetch-level
// mocking these tests rely on. Reinstall a SDK shim that delegates to
// globalThis.fetch so the per-test mockFetch hooks below intercept calls
// the same way they did when this file lived at src/analyze.test.ts.
mock.module("@google/genai", () => ({
  GoogleGenAI: class {
    private apiKey: string;
    constructor(opts: { apiKey: string }) { this.apiKey = opts.apiKey; }
    models = {
      generateContent: async (args: {
        model: string;
        contents: unknown;
        config?: unknown;
      }) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${this.apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: args.contents, generationConfig: args.config }),
        });
        if (!res.ok) {
          throw new Error(JSON.stringify({ error: { message: await res.text(), code: res.status, status: res.statusText } }));
        }
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return { text, usageMetadata: undefined };
      },
    };
  },
}));

// Import directly from analyze-item.ts (not ./index) to avoid bun's module-mock
// cache that other test files (e.g. server.test.ts) install on "./analyze",
// which canonicalizes to ./analyze/index.ts and would otherwise return their stub.
import { analyzeItem } from "./analyze-item";
import { openDatabase, getItemByLotId } from "../db";
import type { AppConfig } from "../config";
import { clearBuildingsCache } from "../location";
import { clearTokenCache } from "../ebay";
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

  it("should use ai source when both eBay comps and AI are available", async () => {
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
      expect(result.item.analysis_source).toBe("ai");
      expect(result.item.recommended_max_bid).not.toBeNull();
      expect(result.item.recommended_max_bid!).toBeGreaterThan(0);
      expect(result.item.llm_provider).toBe("gemini");
      expect(result.item.llm_estimate_mid).toBe(50.00);
      expect(result.item.llm_confidence).toBe(80);
    } finally {
      process.cwd = origCwd;
    }
  });

  it("should use ai source even when AI has no confidence score", async () => {
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
      // AI mid is available — confidence is informational only
      expect(result.item.analysis_source).toBe("ai");
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
      expect(result.item.analysis_source).toBe("ai");
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

  describe("user feedback (US-002)", () => {
    it("preserves persisted user_feedback when option is undefined on re-analyze", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        // Initial analysis with explicit feedback string
        await analyzeItem(12345, config, { userFeedback: "prev user note" });

        // Re-analyze with force but no userFeedback option — should preserve "prev user note"
        clearBuildingsCache();
        clearTokenCache();
        setupMocks();
        const result = await analyzeItem(12345, config, { force: true });
        expect(result.item.user_feedback).toBe("prev user note");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("clears persisted user_feedback when option is explicitly null", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        await analyzeItem(12345, config, { userFeedback: "some note" });

        clearBuildingsCache();
        clearTokenCache();
        setupMocks();
        const result = await analyzeItem(12345, config, { force: true, userFeedback: null });
        expect(result.item.user_feedback).toBeNull();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("sets user_feedback from a string option", async () => {
      setupMocks();
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config, { userFeedback: "the box is sealed" });
        expect(result.item.user_feedback).toBe("the box is sealed");
      } finally {
        process.cwd = origCwd;
      }
    });

    it("suppresses condition-based manual review when feedback is non-empty", async () => {
      setupMocks({
        lotData: {
          id: 12345,
          auction_id: 100,
          lot_number: "42",
          product_name: "Damaged Widget",
          upc: "012345678901",
          condition: "DAMAGED",
          retail_price: 79.99,
          building_id: 15,
          current_bid: 5.00,
          is_open: true,
          total_bids: 3,
          watchers_count: 7,
        },
      });
      const config = makeConfig();
      const origCwd = process.cwd;
      process.cwd = () => tmpDir;

      try {
        const result = await analyzeItem(12345, config, {
          userFeedback: "only the packaging is scuffed; product is fine",
        });
        // Feedback suppresses the condition gate — recommendation should happen via eBay
        expect(result.item.needs_manual_review).toBe(0);
        expect(result.item.analysis_source).toBe("ebay");
        expect(result.item.recommended_max_bid).not.toBeNull();
        expect(result.item.recommended_max_bid!).toBeGreaterThan(0);
        expect(result.item.manual_review_reason).toBeNull();
      } finally {
        process.cwd = origCwd;
      }
    });

    it("still fires image-derived manual review even when feedback is present", async () => {
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
        images: [
          "https://media.mac.bid/stock.jpg",
          "https://media.mac.bid/photo1.jpg",
        ],
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
        const u = String(url);
        if (u.includes("/map-bid/ddb/lot/")) {
          // Return the SSR-ish lot data via DDB endpoint
          return new Response(JSON.stringify(lotData));
        }
        if (u.includes("/buildings")) {
          return new Response(JSON.stringify(buildings));
        }
        if (u.includes("oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "test-token", expires_in: 7200 }));
        }
        if (u.includes("media.mac.bid")) {
          // Image fetch for image analysis — return a tiny PNG
          const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
          return new Response(bytes, { headers: { "content-type": "image/png" } });
        }
        if (u.includes("buy/browse")) {
          return new Response(JSON.stringify({ total: ebayItems.length, itemSummaries: ebayItems }));
        }
        if (u.includes("generativelanguage.googleapis.com")) {
          const body = typeof init?.body === "string" ? init.body : "";
          // Image analysis prompt contains "product condition inspector"
          if (body.includes("product condition inspector") || body.includes("stockImageOnly")) {
            return new Response(JSON.stringify({
              candidates: [{
                content: {
                  parts: [{
                    text: '{"findings":[{"type":"damage","severity":"high","description":"cracked screen","imageIndex":1}],"overallRisk":80,"stockImageOnly":false}',
                  }],
                },
              }],
            }));
          }
          // Search query prompt contains "Extract an optimized eBay search query"
          if (body.includes("Extract an optimized eBay search query")) {
            return new Response(JSON.stringify({
              candidates: [{
                content: {
                  parts: [{ text: "Ninja NJ600 Blender" }],
                },
              }],
            }));
          }
          // Otherwise: price estimate
          return new Response(JSON.stringify({
            candidates: [{
              content: {
                parts: [{ text: '{"low": 35.00, "mid": 50.00, "high": 65.00, "confidence": 80, "reasoning": "ok", "comparables": []}' }],
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
        const result = await analyzeItem(12345, config, {
          userFeedback: "I inspected this in person, looks great",
        });
        // Image-derived manual review must still fire
        expect(result.item.needs_manual_review).toBe(1);
        expect(result.item.manual_review_reason).toContain("Image red flags");
        expect(result.item.user_feedback).toBe("I inspected this in person, looks great");
      } finally {
        process.cwd = origCwd;
      }
    });
  });
});
