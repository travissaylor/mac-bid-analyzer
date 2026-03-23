import { describe, expect, it, afterEach } from "bun:test";
import { getGeminiEstimate } from "./gemini";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const sampleInput = {
  productName: "Ninja Blender NJ600",
  upc: "012345678901",
  condition: "OPEN BOX",
  retailPrice: 79.99,
  category: "Kitchen",
  description: "Professional blender",
};

describe("gemini", () => {
  afterEach(() => {
    restoreFetch();
  });

  describe("getGeminiEstimate", () => {
    it("should parse a valid Gemini response", async () => {
      mockFetch(async (url) => {
        expect(url).toContain("generativelanguage.googleapis.com");
        expect(url).toContain("key=test-key");
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '{"low": 35.00, "mid": 50.00, "high": 65.00}' }],
            },
          }],
        }));
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.low).toBe(35.00);
      expect(result.mid).toBe(50.00);
      expect(result.high).toBe(65.00);
    });

    it("should handle response wrapped in markdown code fences", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '```json\n{"low": 20, "mid": 30, "high": 40}\n```' }],
            },
          }],
        }));
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.low).toBe(20);
      expect(result.mid).toBe(30);
      expect(result.high).toBe(40);
    });

    it("should throw on API error", async () => {
      mockFetch(async () => {
        return new Response("Unauthorized", { status: 401 });
      });

      expect(getGeminiEstimate("bad-key", sampleInput)).rejects.toThrow("Gemini API error (401)");
    });

    it("should throw when response has no text", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [] } }],
        }));
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow("no text content");
    });

    it("should throw when response is not valid JSON", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: "I cannot provide pricing estimates." }],
            },
          }],
        }));
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow("Could not parse JSON");
    });

    it("should throw when JSON is missing required fields", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '{"low": 10, "mid": "not a number", "high": 30}' }],
            },
          }],
        }));
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow("Invalid Gemini estimate format");
    });

    it("should include product details in the request body", async () => {
      let capturedBody: string | undefined;
      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '{"low": 35, "mid": 50, "high": 65}' }],
            },
          }],
        }));
      });

      await getGeminiEstimate("test-key", sampleInput);

      expect(capturedBody).toBeDefined();
      const body = JSON.parse(capturedBody!);
      const prompt = body.contents[0].parts[0].text;
      expect(prompt).toContain("Ninja Blender NJ600");
      expect(prompt).toContain("OPEN BOX");
      expect(prompt).toContain("$79.99");
    });

    it("should handle null optional fields in input", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '{"low": 10, "mid": 20, "high": 30}' }],
            },
          }],
        }));
      });

      const result = await getGeminiEstimate("test-key", {
        productName: "Unknown Widget",
        upc: null,
        condition: "NEW",
        retailPrice: null,
        category: null,
        description: null,
      });

      expect(result.mid).toBe(20);
    });
  });
});
