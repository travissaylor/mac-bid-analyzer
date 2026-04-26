import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { openDatabase, upsertAnalyzedItem } from "./db";
import type { AnalyzedItem } from "./shared/types";
import { Database } from "bun:sqlite";

type AnalyzeCall = {
  lotId: number;
  options: {
    force?: boolean;
    dryRun?: boolean;
    ssrData?: Record<string, unknown>;
    userFeedback?: string | null;
  };
};

const analyzeCalls: AnalyzeCall[] = [];

mock.module("./analyze", () => ({
  parseLotId: (input: string) => {
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Cannot parse lot ID from: ${input}`);
    }
    return n;
  },
  resolveLotId: async (input: number | string) => ({
    lotId: typeof input === "number" ? input : Number(input),
    ssrData: undefined,
  }),
  analyzeItem: async (
    lotId: number,
    _config: unknown,
    options: AnalyzeCall["options"] = {}
  ) => {
    analyzeCalls.push({ lotId, options });
    return {
      item: { lot_id: lotId, product_name: "stub" } as unknown as AnalyzedItem,
      skipped: false,
    };
  },
}));

mock.module("./config", () => ({
  loadConfig: () => ({}),
}));

mock.module("./location", () => ({
  clearBuildingsCache: () => {},
}));

const { handleRequest } = await import("./server");

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
    discount_threshold: 0.3,
    lot_fee: 3.0,
    buyers_premium_rate: 0.15,
    deal_score: 58,
    image_flags: null,
    image_risk_score: null,
    image_analysis_skipped: null,
    needs_manual_review: 0,
    manual_review_reason: null,
    analyzed_at: "2026-03-22T10:00:00Z",
    analysis_source: "ai",
    user_feedback: null,
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
    // US-003: response includes user_feedback field
    expect("user_feedback" in body).toBe(true);
    expect(body.user_feedback).toBeNull();
  });

  test("returns user_feedback when present on row", async () => {
    const withFeedback = makeItem({ lot_id: 99998, user_feedback: "seller notes" });
    upsertAnalyzedItem(db, withFeedback);
    try {
      const res = await handleRequest(req("/api/lot/99998", {
        headers: authHeaders(),
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user_feedback).toBe("seller notes");
    } finally {
      db.prepare("DELETE FROM analyzed_items WHERE lot_id = 99998").run();
    }
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

describe("POST /api/analyze user_feedback handling", () => {
  function lastCall(): AnalyzeCall {
    return analyzeCalls[analyzeCalls.length - 1];
  }

  test("absent user_feedback → undefined, force respected (false)", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345" }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.lotId).toBe(12345);
    expect(call.options.userFeedback).toBeUndefined();
    expect(call.options.force).toBe(false);
  });

  test("absent user_feedback with force:true → undefined, force true", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", force: true }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.options.userFeedback).toBeUndefined();
    expect(call.options.force).toBe(true);
  });

  test("user_feedback: '' → null AND force implied true", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", user_feedback: "" }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.options.userFeedback).toBeNull();
    expect(call.options.force).toBe(true);
  });

  test("user_feedback: 'some note' → string AND force implied true", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", user_feedback: "some note" }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.options.userFeedback).toBe("some note");
    expect(call.options.force).toBe(true);
  });

  test("user_feedback: null → null AND force implied true", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", user_feedback: null }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.options.userFeedback).toBeNull();
    expect(call.options.force).toBe(true);
  });

  test("user_feedback with force:false still forces due to presence", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", user_feedback: "note", force: false }),
    }));
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.options.force).toBe(true);
  });

  test("user_feedback of invalid type → 400", async () => {
    analyzeCalls.length = 0;
    const res = await handleRequest(req("/api/analyze", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ input: "12345", user_feedback: 42 }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("user_feedback");
    expect(analyzeCalls.length).toBe(0);
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
