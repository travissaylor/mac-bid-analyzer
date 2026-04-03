import { describe, expect, it } from "bun:test";
import { buildPrompt, buildUserPrompt, extractJson, parseEstimateResponse } from "./prompt";
import type { LLMInput } from "./index";

const sampleInput: LLMInput = {
  productName: "Ninja Blender NJ600",
  upc: "012345678901",
  condition: "OPEN BOX",
  retailPrice: 79.99,
  category: "Kitchen",
  description: "Professional blender",
  ebaySoldMedian: null,
  ebaySoldCount: null,
  ebaySearchQuery: null,
  ebaySearchStrategy: null,
  ebayFiltersRelaxed: null,
};

describe("llm/prompt", () => {
  describe("buildPrompt", () => {
    it("should include all product details", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("Ninja Blender NJ600");
      expect(prompt).toContain("012345678901");
      expect(prompt).toContain("OPEN BOX");
      expect(prompt).toContain("$79.99");
      expect(prompt).toContain("Kitchen");
      expect(prompt).toContain("Professional blender");
    });

    it("should omit null optional fields", () => {
      const prompt = buildPrompt({
        productName: "Widget",
        upc: null,
        condition: "NEW",
        retailPrice: null,
        category: null,
        description: null,
        ebaySoldMedian: null,
        ebaySoldCount: null,
        ebaySearchQuery: null,
        ebaySearchStrategy: null,
        ebayFiltersRelaxed: null,
      });
      expect(prompt).toContain("Widget");
      expect(prompt).toContain("NEW");
      expect(prompt).not.toContain("UPC:");
      expect(prompt).not.toContain("Retail Price:");
      expect(prompt).not.toContain("Category:");
      expect(prompt).not.toContain("Description:");
      expect(prompt).toContain("eBay Comps: No completed sales found");
    });

    it("should request JSON response format", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("confidence");
      expect(prompt).toContain("reasoning");
      expect(prompt).toContain("comparables");
      expect(prompt).toContain("JSON");
    });

    it("should emphasize the AI is the primary estimator", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("primary market value estimator");
      expect(prompt).toContain("mid\" estimate is used directly to calculate the recommended maximum bid");
    });

    it("should warn against retail price anchoring", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("Do NOT anchor your estimate to the retail price");
      expect(prompt).toContain("Secondary market values are often 10–50% of retail");
    });

    it("should include brand recognition guidance", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("Unknown or generic brands");
      expect(prompt).toContain("significantly lower resale value");
    });

    it("should include category depreciation guidance", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("Furniture and home goods depreciate heavily");
      expect(prompt).toContain("electronics brands retain more value");
    });

    it("should include condition guidance", () => {
      const prompt = buildPrompt(sampleInput);
      expect(prompt).toContain("Open Box");
      expect(prompt).toContain("As-Is");
      expect(prompt).toContain("sell for less than new");
    });

    it("should include eBay sold data when available", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 210.14,
        ebaySoldCount: 34,
      });
      expect(prompt).toContain("eBay Sold Median: $210.14 (34 recent sales)");
      expect(prompt).not.toContain("No completed sales found");
    });

    it("should show no comps message when eBay count is 0", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 0,
        ebaySoldCount: 0,
      });
      expect(prompt).toContain("eBay Comps: No completed sales found");
      expect(prompt).not.toContain("eBay Sold Median:");
    });

    it("should show no comps message when eBay fields are null", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: null,
        ebaySoldCount: null,
      });
      expect(prompt).toContain("eBay Comps: No completed sales found");
    });

    it("should treat zero median with positive count as no comps", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 0,
        ebaySoldCount: 5,
      });
      expect(prompt).toContain("eBay Comps: No completed sales found");
    });

    it("should include search provenance when eBay data is available", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 55.00,
        ebaySoldCount: 8,
        ebaySearchQuery: "llm:Ninja Blender NJ600",
        ebaySearchStrategy: "llm",
        ebayFiltersRelaxed: false,
      });
      expect(prompt).toContain("eBay Search Query: llm:Ninja Blender NJ600");
      expect(prompt).toContain("eBay Search Method: matched by LLM-refined search query");
      expect(prompt).not.toContain("filters were relaxed");
    });

    it("should include UPC strategy description", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 55.00,
        ebaySoldCount: 8,
        ebaySearchQuery: "upc:012345678901",
        ebaySearchStrategy: "upc",
        ebayFiltersRelaxed: false,
      });
      expect(prompt).toContain("eBay Search Method: matched by UPC/GTIN (high confidence)");
    });

    it("should include broad strategy description", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 55.00,
        ebaySoldCount: 8,
        ebaySearchQuery: "llm-broad:Ninja Blender",
        ebaySearchStrategy: "llm-broad",
        ebayFiltersRelaxed: false,
      });
      expect(prompt).toContain("eBay Search Method: matched by broadened fallback query (lower specificity)");
    });

    it("should include relaxed filters warning when filters were relaxed", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: 55.00,
        ebaySoldCount: 8,
        ebaySearchQuery: "llm-relaxed:Ninja Blender NJ600",
        ebaySearchStrategy: "llm",
        ebayFiltersRelaxed: true,
      });
      expect(prompt).toContain("Condition filters were relaxed");
      expect(prompt).toContain("mixed conditions");
    });

    it("should not include provenance when no eBay data found", () => {
      const prompt = buildUserPrompt({
        ...sampleInput,
        ebaySoldMedian: null,
        ebaySoldCount: null,
        ebaySearchQuery: "llm:Ninja Blender NJ600",
        ebaySearchStrategy: "llm",
        ebayFiltersRelaxed: false,
      });
      expect(prompt).not.toContain("eBay Search Query:");
      expect(prompt).not.toContain("eBay Search Method:");
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

  describe("parseEstimateResponse", () => {
    it("should parse a valid full response", () => {
      const text = JSON.stringify({
        low: 35, mid: 50, high: 65,
        confidence: 82,
        reasoning: "Based on similar blenders",
        comparables: [{ name: "Ninja BL610", estimatedPrice: 45 }],
      });
      const result = parseEstimateResponse(text);
      expect(result.low).toBe(35);
      expect(result.mid).toBe(50);
      expect(result.high).toBe(65);
      expect(result.confidence).toBe(82);
      expect(result.reasoning).toBe("Based on similar blenders");
      expect(result.comparables).toEqual([{ name: "Ninja BL610", estimatedPrice: 45 }]);
    });

    it("should handle missing optional fields", () => {
      const result = parseEstimateResponse('{"low": 35, "mid": 50, "high": 65}');
      expect(result.low).toBe(35);
      expect(result.confidence).toBeNull();
      expect(result.reasoning).toBeNull();
      expect(result.comparables).toBeNull();
    });

    it("should filter invalid comparables", () => {
      const text = JSON.stringify({
        low: 10, mid: 20, high: 30,
        confidence: 50,
        reasoning: "Rough estimate",
        comparables: [{ invalid: true }],
      });
      const result = parseEstimateResponse(text);
      expect(result.comparables).toBeNull();
    });

    it("should reject out-of-range confidence scores", () => {
      const result = parseEstimateResponse('{"low": 10, "mid": 20, "high": 30, "confidence": 150}');
      expect(result.confidence).toBeNull();
    });

    it("should throw when no JSON found", () => {
      expect(() => parseEstimateResponse("no json here")).toThrow("Could not parse JSON");
    });

    it("should throw when required fields are missing", () => {
      expect(() => parseEstimateResponse('{"low": 10, "mid": "bad", "high": 30}')).toThrow("Invalid LLM estimate format");
    });

    it("should handle markdown-wrapped responses", () => {
      const result = parseEstimateResponse('```json\n{"low": 20, "mid": 30, "high": 40}\n```');
      expect(result.low).toBe(20);
      expect(result.mid).toBe(30);
      expect(result.high).toBe(40);
    });
  });
});
