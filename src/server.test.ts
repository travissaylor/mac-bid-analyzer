import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { handleRequest } from "./server";
import { openDatabase, upsertAnalyzedItem } from "./db";
import type { AnalyzedItem } from "./db";
import { Database } from "bun:sqlite";

const TEST_TOKEN = "test-token-server-123";
const BASE = "http://localhost:3000";

let db: Database;
let originalToken: string | undefined;

function makeItem(overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    lot_id: 99999,
    auction_id: 100,
    lot_number: "A1",
    product_name: "Test MacBook Pro",
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
    llm_provider: "gemini",
    llm_confidence: 82,
    llm_reasoning: "High-end laptop in like-new condition.",
    llm_comparables: null,
    recommended_max_bid: 1200,
    sales_tax_rate: 0.07,
    location_cost: 5,
    location_tier: "local",
    deal_score: 58,
    image_flags: null,
    image_risk_score: null,
    image_analysis_skipped: null,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "ai",
    ...overrides,
  };
}

function req(path: string, options: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, options);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

beforeAll(() => {
  originalToken = Bun.env.API_TOKEN;
  process.env.API_TOKEN = TEST_TOKEN;

  // Seed a test item
  db = openDatabase();
  upsertAnalyzedItem(db, makeItem());
});

afterAll(() => {
  // Clean up test data
  db.prepare("DELETE FROM analyzed_items WHERE lot_id = 99999").run();
  db.close();
  if (originalToken !== undefined) {
    process.env.API_TOKEN = originalToken;
  } else {
    delete process.env.API_TOKEN;
  }
});

describe("server auth", () => {
  test("returns 401 without auth header", async () => {
    const res = await handleRequest(req("/api/lot/99999"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 401 with wrong token", async () => {
    const res = await handleRequest(req("/api/lot/99999", {
      headers: { Authorization: "Bearer wrong-token" },
    }));
    expect(res.status).toBe(401);
  });

  test("returns 401 with malformed auth header", async () => {
    const res = await handleRequest(req("/api/lot/99999", {
      headers: { Authorization: "Basic abc123" },
    }));
    expect(res.status).toBe(401);
  });
});

describe("CORS", () => {
  test("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await handleRequest(req("/api/analyze", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  test("responses include CORS headers", async () => {
    const res = await handleRequest(req("/api/lot/99999", {
      headers: authHeaders(),
    }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("GET /api/lot/:lotId", () => {
  test("returns cached item", async () => {
    const res = await handleRequest(req("/api/lot/99999", {
      headers: authHeaders(),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lot_id).toBe(99999);
    expect(body.product_name).toBe("Test MacBook Pro");
  });

  test("returns 404 for unknown lot", async () => {
    const res = await handleRequest(req("/api/lot/1", {
      headers: authHeaders(),
    }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 404 for non-numeric lot ID path", async () => {
    const res = await handleRequest(req("/api/lot/abc", {
      headers: authHeaders(),
    }));
    // Non-numeric lotId won't match the route regex, so 404
    expect(res.status).toBe(404);
  });
});

describe("POST /api/analyze", () => {
  test("returns 400 for invalid JSON", async () => {
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "not json",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  test("returns 400 for missing input field", async () => {
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("input");
  });

  test("returns 400 for empty input field", async () => {
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "" }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("input");
  });

  test("returns 500 for unparseable input", async () => {
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "not-a-valid-lot" }),
    }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Cannot parse lot ID");
  });
});

describe("unknown routes", () => {
  test("returns 404 for unknown path", async () => {
    const res = await handleRequest(req("/api/unknown", {
      headers: authHeaders(),
    }));
    expect(res.status).toBe(404);
  });
});
