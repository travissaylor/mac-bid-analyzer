import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import {
  clearTokenCache,
  getEbayToken,
  searchEbaySoldListings,
  searchEbay,
  searchEbayCascade,
  broadenQuery,
} from "./ebay";

// Mock global fetch
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("ebay", () => {
  beforeEach(() => {
    clearTokenCache();
    restoreFetch();
  });

  describe("getEbayToken", () => {
    it("should fetch a new token", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("oauth2/token");
        return new Response(
          JSON.stringify({ access_token: "test-token-123", expires_in: 7200 }),
          { status: 200 }
        );
      });

      const token = await getEbayToken("app-id", "app-secret");
      expect(token).toBe("test-token-123");
    });

    it("should cache the token on subsequent calls", async () => {
      let callCount = 0;
      mockFetch(async () => {
        callCount++;
        return new Response(
          JSON.stringify({ access_token: "cached-token", expires_in: 7200 }),
          { status: 200 }
        );
      });

      await getEbayToken("app-id", "app-secret");
      const token2 = await getEbayToken("app-id", "app-secret");
      expect(token2).toBe("cached-token");
      expect(callCount).toBe(1);
    });

    it("should throw on auth failure", async () => {
      mockFetch(async () => {
        return new Response("Unauthorized", { status: 401 });
      });

      expect(getEbayToken("bad-id", "bad-secret")).rejects.toThrow(
        "eBay OAuth failed (401)"
      );
    });

    it("should send base64 credentials", async () => {
      mockFetch(async (_url, init) => {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization;
        const expected = Buffer.from("myapp:mysecret").toString("base64");
        expect(authHeader).toBe(`Basic ${expected}`);
        return new Response(
          JSON.stringify({ access_token: "tok", expires_in: 3600 }),
          { status: 200 }
        );
      });

      await getEbayToken("myapp", "mysecret");
    });
  });

  describe("searchEbaySoldListings", () => {
    it("should search by UPC when UPC is provided", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("gtin=012345678901");
        return new Response(
          JSON.stringify({
            total: 3,
            itemSummaries: [
              { price: { value: "50.00" } },
              { price: { value: "60.00" } },
              { price: { value: "40.00" } },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        "012345678901",
        "Test Product",
        "NEW"
      );
      expect(result).not.toBeNull();
      expect(result!.count).toBe(3);
      expect(result!.median).toBe(50);
      expect(result!.low).toBe(40);
      expect(result!.high).toBe(60);
      expect(result!.searchQuery).toBe("upc:012345678901");
    });

    it("should search by name when UPC is an ASIN", async () => {
      mockFetch(async (url) => {
        expect(url).not.toContain("gtin=");
        expect(url).toContain("q=Ninja+Blender");
        return new Response(
          JSON.stringify({
            total: 2,
            itemSummaries: [
              { price: { value: "30.00" } },
              { price: { value: "50.00" } },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        "B0ABCD1234",
        "Ninja Blender",
        "NEW"
      );
      expect(result).not.toBeNull();
      expect(result!.searchQuery).toBe("llm:Ninja Blender");
      expect(result!.median).toBe(40);
    });

    it("should search by name when UPC is null", async () => {
      mockFetch(async (url) => {
        expect(url).not.toContain("gtin=");
        return new Response(
          JSON.stringify({ total: 0 }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        null,
        "Some Product",
        "NEW"
      );
      expect(result).not.toBeNull();
      expect(result!.count).toBe(0);
      expect(result!.searchQuery).toBe("llm:Some Product");
    });

    it("should return zero counts when no items found", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      });

      const result = await searchEbaySoldListings(
        "token",
        "012345678901",
        "Nothing",
        "NEW"
      );
      expect(result!.count).toBe(0);
      expect(result!.median).toBe(0);
      expect(result!.low).toBe(0);
      expect(result!.high).toBe(0);
    });

    it("should throw on API error", async () => {
      mockFetch(async () => {
        return new Response("Server Error", { status: 500 });
      });

      expect(
        searchEbaySoldListings("token", "012345678901", "Product", "NEW")
      ).rejects.toThrow("eBay search failed (500)");
    });

    it("should calculate median correctly for even count", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 4,
            itemSummaries: [
              { price: { value: "10.00" } },
              { price: { value: "20.00" } },
              { price: { value: "30.00" } },
              { price: { value: "40.00" } },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        "012345678901",
        "Product",
        "NEW"
      );
      expect(result!.median).toBe(25); // (20+30)/2
    });

    it("should calculate median correctly for odd count", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 5,
            itemSummaries: [
              { price: { value: "10.00" } },
              { price: { value: "20.00" } },
              { price: { value: "30.00" } },
              { price: { value: "40.00" } },
              { price: { value: "50.00" } },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        "012345678901",
        "Product",
        "NEW"
      );
      expect(result!.median).toBe(30);
    });

    it("should filter out items with invalid prices", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 4,
            itemSummaries: [
              { price: { value: "50.00" } },
              { price: { value: "" } },
              { price: { value: "0" } },
              { price: { value: "100.00" } },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbaySoldListings(
        "token",
        "012345678901",
        "Product",
        "NEW"
      );
      expect(result!.count).toBe(2);
      expect(result!.low).toBe(50);
      expect(result!.high).toBe(100);
    });

    it("should send condition filter for OPEN BOX", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("conditionIds");
        return new Response(
          JSON.stringify({ total: 0 }),
          { status: 200 }
        );
      });

      await searchEbaySoldListings("token", "012345678901", "Product", "OPEN BOX");
    });

    it("should not send condition filter for USED", async () => {
      mockFetch(async (url) => {
        expect(url).not.toContain("conditionIds");
        return new Response(
          JSON.stringify({ total: 0 }),
          { status: 200 }
        );
      });

      await searchEbaySoldListings("token", "012345678901", "Product", "USED");
    });
  });

  describe("searchEbay", () => {
    it("should return null on error without crashing", async () => {
      mockFetch(async () => {
        return new Response("Unauthorized", { status: 401 });
      });

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const result = await searchEbay(
        "bad-id",
        "bad-secret",
        "012345678901",
        "Product",
        "NEW"
      );
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it("should return cascade results on success", async () => {
      let callNum = 0;
      mockFetch(async () => {
        callNum++;
        if (callNum === 1) {
          // OAuth call
          return new Response(
            JSON.stringify({ access_token: "tok", expires_in: 3600 }),
            { status: 200 }
          );
        }
        // Search call
        return new Response(
          JSON.stringify({
            total: 1,
            itemSummaries: [{ price: { value: "75.00" } }],
          }),
          { status: 200 }
        );
      });

      const result = await searchEbay(
        "app-id",
        "app-secret",
        "012345678901",
        "Product",
        "NEW",
        { minComps: 1 },
      );
      expect(result).not.toBeNull();
      expect(result!.result.count).toBe(1);
      expect(result!.result.median).toBe(75);
      expect(result!.cascadeDepth).toBe(1); // UPC search succeeded
    });
  });

  describe("broadenQuery", () => {
    it("should return null for short queries", () => {
      expect(broadenQuery("Apple MacBook")).toBeNull();
    });

    it("should keep roughly half the words", () => {
      expect(broadenQuery("Apple MacBook Pro 14 M3 Pro 18GB 512GB")).toBe("Apple MacBook Pro 14");
    });

    it("should return null for two-word queries", () => {
      expect(broadenQuery("Ninja Blender")).toBeNull();
    });

    it("should broaden three-word query to two words", () => {
      expect(broadenQuery("Ninja NJ600 Blender")).toBe("Ninja NJ600");
    });
  });

  describe("searchEbayCascade", () => {
    it("should stop at UPC step when sufficient comps found", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 5,
            itemSummaries: Array(5).fill({ price: { value: "50.00" } }),
          }),
          { status: 200 }
        );
      });

      const logs: string[] = [];
      const result = await searchEbayCascade(
        { token: "tok", upc: "012345678901", llmQuery: "Ninja Blender", condition: "NEW", minComps: 5 },
        (msg) => logs.push(msg),
      );
      expect(result.cascadeDepth).toBe(1);
      expect(result.result.strategy).toBe("upc");
      expect(result.result.count).toBe(5);
      expect(logs.some((l) => l.includes("step 1") && l.includes("sufficient"))).toBe(true);
    });

    it("should fall through to LLM query when UPC returns insufficient comps", async () => {
      let callNum = 0;
      mockFetch(async () => {
        callNum++;
        if (callNum === 1) {
          // UPC search - insufficient
          return new Response(
            JSON.stringify({ total: 2, itemSummaries: [{ price: { value: "50.00" } }, { price: { value: "60.00" } }] }),
            { status: 200 }
          );
        }
        // LLM query - sufficient
        return new Response(
          JSON.stringify({
            total: 6,
            itemSummaries: Array(6).fill({ price: { value: "55.00" } }),
          }),
          { status: 200 }
        );
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: "012345678901", llmQuery: "Ninja Blender", condition: "NEW", minComps: 5 },
      );
      expect(result.cascadeDepth).toBe(2);
      expect(result.result.strategy).toBe("llm");
      expect(result.result.count).toBe(6);
    });

    it("should skip UPC step when UPC is null", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 5,
            itemSummaries: Array(5).fill({ price: { value: "50.00" } }),
          }),
          { status: 200 }
        );
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: null, llmQuery: "Ninja Blender", condition: "NEW", minComps: 5 },
      );
      expect(result.cascadeDepth).toBe(2);
      expect(result.result.strategy).toBe("llm");
    });

    it("should skip UPC step when UPC is ASIN", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 5,
            itemSummaries: Array(5).fill({ price: { value: "50.00" } }),
          }),
          { status: 200 }
        );
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: "B0ABCDEFGH", llmQuery: "Ninja Blender", condition: "NEW", minComps: 5 },
      );
      expect(result.cascadeDepth).toBe(2);
      expect(result.result.strategy).toBe("llm");
    });

    it("should fall through to broad query when LLM query returns insufficient", async () => {
      let callNum = 0;
      mockFetch(async () => {
        callNum++;
        if (callNum <= 2) {
          // UPC and LLM - insufficient
          return new Response(
            JSON.stringify({ total: 1, itemSummaries: [{ price: { value: "50.00" } }] }),
            { status: 200 }
          );
        }
        // Broad query - sufficient
        return new Response(
          JSON.stringify({
            total: 7,
            itemSummaries: Array(7).fill({ price: { value: "45.00" } }),
          }),
          { status: 200 }
        );
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: "012345678901", llmQuery: "Apple MacBook Pro 14 M3", condition: "NEW", minComps: 5 },
      );
      expect(result.cascadeDepth).toBe(3);
      expect(result.result.strategy).toBe("llm-broad");
      expect(result.result.count).toBe(7);
    });

    it("should return best result when all steps are insufficient", async () => {
      let callNum = 0;
      mockFetch(async () => {
        callNum++;
        if (callNum === 1) return new Response(JSON.stringify({ total: 1, itemSummaries: [{ price: { value: "50.00" } }] }), { status: 200 });
        if (callNum === 2) return new Response(JSON.stringify({ total: 3, itemSummaries: [{ price: { value: "40.00" } }, { price: { value: "50.00" } }, { price: { value: "60.00" } }] }), { status: 200 });
        // Broad query
        return new Response(JSON.stringify({ total: 2, itemSummaries: [{ price: { value: "45.00" } }, { price: { value: "55.00" } }] }), { status: 200 });
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: "012345678901", llmQuery: "Apple MacBook Pro 14 M3", condition: "NEW", minComps: 5 },
      );
      // Best result is from LLM query with 3 comps
      expect(result.result.count).toBe(3);
      expect(result.result.strategy).toBe("llm");
    });

    it("should record strategy label with prefix in searchQuery", async () => {
      mockFetch(async () => {
        return new Response(
          JSON.stringify({
            total: 5,
            itemSummaries: Array(5).fill({ price: { value: "50.00" } }),
          }),
          { status: 200 }
        );
      });

      const result = await searchEbayCascade(
        { token: "tok", upc: "012345678901", llmQuery: "Ninja Blender", condition: "NEW", minComps: 5 },
      );
      expect(result.result.searchQuery).toBe("upc:012345678901");
    });
  });

  describe("ASIN detection", () => {
    it("should detect B0-prefixed 10-char strings as ASIN", async () => {
      mockFetch(async (url) => {
        expect(url).not.toContain("gtin=");
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      });

      await searchEbaySoldListings("token", "B0ABCDEFGH", "Product", "NEW");
    });

    it("should not treat B0 prefix with wrong length as ASIN", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("gtin=B0ABC");
        return new Response(JSON.stringify({ total: 0 }), { status: 200 });
      });

      await searchEbaySoldListings("token", "B0ABC", "Product", "NEW");
    });
  });
});
