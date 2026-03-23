import { describe, expect, it, afterEach } from "bun:test";
import { getGeminiEstimate, extractJson } from "./gemini";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function geminiResponse(text: string) {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text }],
        role: "model",
      },
      finishReason: "STOP",
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  }), {
    headers: { "Content-Type": "application/json" },
  });
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
    it("should parse a valid Gemini response with full analysis", async () => {
      mockFetch(async (url) => {
        expect(String(url)).toContain("generativelanguage.googleapis.com");
        expect(String(url)).toContain("gemini-2.5-flash");
        return geminiResponse(JSON.stringify({
          low: 35, mid: 50, high: 65,
          confidence: 82,
          reasoning: "Based on similar blenders",
          comparables: [{ name: "Ninja BL610", estimatedPrice: 45 }],
        }));
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.low).toBe(35);
      expect(result.mid).toBe(50);
      expect(result.high).toBe(65);
      expect(result.confidence).toBe(82);
      expect(result.reasoning).toBe("Based on similar blenders");
      expect(result.comparables).toEqual([{ name: "Ninja BL610", estimatedPrice: 45 }]);
    });

    it("should handle response wrapped in markdown code fences", async () => {
      mockFetch(async () => {
        return geminiResponse('```json\n{"low": 20, "mid": 30, "high": 40, "confidence": 70, "reasoning": "test", "comparables": []}\n```');
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.low).toBe(20);
      expect(result.mid).toBe(30);
      expect(result.high).toBe(40);
    });

    it("should gracefully handle missing optional fields", async () => {
      mockFetch(async () => {
        return geminiResponse('{"low": 35, "mid": 50, "high": 65}');
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.low).toBe(35);
      expect(result.mid).toBe(50);
      expect(result.high).toBe(65);
      expect(result.confidence).toBeNull();
      expect(result.reasoning).toBeNull();
      expect(result.comparables).toBeNull();
    });

    it("should handle partial fields (valid prices but invalid comparables)", async () => {
      mockFetch(async () => {
        return geminiResponse(JSON.stringify({
          low: 10, mid: 20, high: 30,
          confidence: 50,
          reasoning: "Rough estimate",
          comparables: [{ invalid: true }],
        }));
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.mid).toBe(20);
      expect(result.confidence).toBe(50);
      expect(result.comparables).toBeNull();
    });

    it("should reject out-of-range confidence scores", async () => {
      mockFetch(async () => {
        return geminiResponse('{"low": 10, "mid": 20, "high": 30, "confidence": 150}');
      });

      const result = await getGeminiEstimate("test-key", sampleInput);
      expect(result.confidence).toBeNull();
    });

    it("should throw on API error", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          error: { message: "Unauthorized", code: 401 },
        }), { status: 401, headers: { "Content-Type": "application/json" } });
      });

      expect(getGeminiEstimate("bad-key", sampleInput)).rejects.toThrow();
    });

    it("should throw when response has no text", async () => {
      mockFetch(async () => {
        return new Response(JSON.stringify({
          candidates: [{
            content: { parts: [], role: "model" },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
        }), { headers: { "Content-Type": "application/json" } });
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow();
    });

    it("should throw when response is not valid JSON", async () => {
      mockFetch(async () => {
        return geminiResponse("I cannot provide pricing estimates.");
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow("Could not parse JSON");
    });

    it("should throw when JSON is missing required fields", async () => {
      mockFetch(async () => {
        return geminiResponse('{"low": 10, "mid": "not a number", "high": 30}');
      });

      expect(getGeminiEstimate("test-key", sampleInput)).rejects.toThrow("Invalid Gemini estimate format");
    });

    it("should include product details in the request body", async () => {
      let capturedBody: string | undefined;
      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return geminiResponse('{"low": 35, "mid": 50, "high": 65}');
      });

      await getGeminiEstimate("test-key", sampleInput);

      expect(capturedBody).toBeDefined();
      const body = JSON.parse(capturedBody!);
      const prompt = body.contents[0].parts[0].text;
      expect(prompt).toContain("Ninja Blender NJ600");
      expect(prompt).toContain("OPEN BOX");
      expect(prompt).toContain("$79.99");
      expect(prompt).toContain("confidence");
      expect(prompt).toContain("reasoning");
      expect(prompt).toContain("comparables");
    });

    it("should handle null optional fields in input", async () => {
      mockFetch(async () => {
        return geminiResponse('{"low": 10, "mid": 20, "high": 30}');
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

  describe("extractJson", () => {
    it("should extract a simple JSON object", () => {
      expect(extractJson('{"a": 1}')).toBe('{"a": 1}');
    });

    it("should extract nested JSON objects", () => {
      const input = '{"a": {"b": 1}, "c": [{"d": 2}]}';
      expect(extractJson(input)).toBe(input);
    });

    it("should extract JSON from surrounding text", () => {
      expect(extractJson('Here is the result: {"x": 1} done')).toBe('{"x": 1}');
    });

    it("should return null when no JSON found", () => {
      expect(extractJson("no json here")).toBeNull();
    });

    it("should handle JSON with markdown code fences", () => {
      const result = extractJson('```json\n{"low": 10, "high": 20}\n```');
      expect(result).toBe('{"low": 10, "high": 20}');
    });
  });
});
