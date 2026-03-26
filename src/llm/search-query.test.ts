import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { SearchQueryInput } from "./search-query";

// Mock the @google/genai module before importing
const mockGenerateContent = mock(() =>
  Promise.resolve({
    text: "Ninja NJ600 Professional Blender",
  })
);

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
    };
  },
}));

const {
  generateSearchQuery,
  generateSearchQuerySafe,
  SEARCH_QUERY_PROMPT,
  buildSearchQueryUserPrompt,
} = await import("./search-query");

const sampleInput: SearchQueryInput = {
  productName: "Ninja Professional Blender NJ600 - Brand New in Box!",
  description: "Great for smoothies and food processing",
  upc: "012345678901",
  category: "Kitchen",
  condition: "OPEN BOX",
};

describe("search-query", () => {
  beforeEach(() => {
    mockGenerateContent.mockClear();
    mockGenerateContent.mockImplementation(() =>
      Promise.resolve({
        text: "Ninja NJ600 Professional Blender",
      })
    );
  });

  describe("SEARCH_QUERY_PROMPT", () => {
    it("should instruct the LLM to return only a search query string", () => {
      expect(SEARCH_QUERY_PROMPT).toContain("Return ONLY the search query string");
      expect(SEARCH_QUERY_PROMPT).toContain("no JSON");
    });

    it("should instruct to strip noise and marketing fluff", () => {
      expect(SEARCH_QUERY_PROMPT).toContain("Strip marketing fluff");
    });

    it("should instruct to prioritize brand and model number", () => {
      expect(SEARCH_QUERY_PROMPT).toContain("brand name");
      expect(SEARCH_QUERY_PROMPT).toContain("model number");
    });
  });

  describe("buildSearchQueryUserPrompt", () => {
    it("should include product name", () => {
      const prompt = buildSearchQueryUserPrompt(sampleInput);
      expect(prompt).toContain("Product: Ninja Professional Blender NJ600");
    });

    it("should include description when available", () => {
      const prompt = buildSearchQueryUserPrompt(sampleInput);
      expect(prompt).toContain("Description: Great for smoothies");
    });

    it("should include UPC when available", () => {
      const prompt = buildSearchQueryUserPrompt(sampleInput);
      expect(prompt).toContain("UPC: 012345678901");
    });

    it("should include category when available", () => {
      const prompt = buildSearchQueryUserPrompt(sampleInput);
      expect(prompt).toContain("Category: Kitchen");
    });

    it("should omit null fields", () => {
      const prompt = buildSearchQueryUserPrompt({
        productName: "Test Product",
        description: null,
        upc: null,
        category: null,
        condition: "NEW",
      });
      expect(prompt).toBe("Product: Test Product");
      expect(prompt).not.toContain("Description");
      expect(prompt).not.toContain("UPC");
      expect(prompt).not.toContain("Category");
    });

    it("should not include condition in the prompt sent to LLM", () => {
      const prompt = buildSearchQueryUserPrompt(sampleInput);
      expect(prompt).not.toContain("Condition:");
    });
  });

  describe("generateSearchQuery", () => {
    it("should call Gemini and return the search query", async () => {
      const result = await generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key");

      expect(result).toBe("Ninja NJ600 Professional Blender");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should pass correct parameters to Gemini", async () => {
      await generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key");

      const callArgs = (mockGenerateContent.mock.lastCall as unknown[])[0] as Record<string, unknown>;
      expect(callArgs.model).toBe("gemini-2.0-flash-lite");
      expect(callArgs.contents).toContain("Ninja Professional Blender NJ600");
      expect(callArgs.contents).toContain(SEARCH_QUERY_PROMPT);
      const config = callArgs.config as Record<string, unknown>;
      expect(config.temperature).toBe(0.0);
    });

    it("should throw when LLM returns empty response", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.resolve({ text: "" })
      );

      expect(
        generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key")
      ).rejects.toThrow("LLM returned empty or too-short search query");
    });

    it("should throw when LLM returns too-short response", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.resolve({ text: "ab" })
      );

      expect(
        generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key")
      ).rejects.toThrow("LLM returned empty or too-short search query");
    });

    it("should throw when LLM returns null text", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.resolve({ text: null as unknown as string })
      );

      expect(
        generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key")
      ).rejects.toThrow("LLM returned empty or too-short search query");
    });

    it("should trim whitespace from the response", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.resolve({ text: "  Ninja NJ600 Blender  \n" })
      );

      const result = await generateSearchQuery(sampleInput, "gemini", "gemini-2.0-flash-lite", "test-key");
      expect(result).toBe("Ninja NJ600 Blender");
    });

    it("should throw for unsupported provider", async () => {
      expect(
        generateSearchQuery(sampleInput, "anthropic", "claude-3", "test-key")
      ).rejects.toThrow("Unsupported provider");
    });
  });

  describe("generateSearchQuerySafe", () => {
    it("should return LLM-generated query on success", async () => {
      const result = await generateSearchQuerySafe(
        sampleInput,
        "gemini/gemini-2.0-flash-lite",
        { geminiApiKey: "test-key", openaiApiKey: "" }
      );

      expect(result.query).toBe("Ninja NJ600 Professional Blender");
      expect(result.source).toBe("llm");
    });

    it("should fall back to product name when no API key", async () => {
      const result = await generateSearchQuerySafe(
        sampleInput,
        "gemini/gemini-2.0-flash-lite",
        { geminiApiKey: "", openaiApiKey: "" }
      );

      expect(result.query).toBe(sampleInput.productName);
      expect(result.source).toBe("raw");
    });

    it("should fall back to product name when LLM fails", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.reject(new Error("API rate limit exceeded"))
      );

      const result = await generateSearchQuerySafe(
        sampleInput,
        "gemini/gemini-2.0-flash-lite",
        { geminiApiKey: "test-key", openaiApiKey: "" }
      );

      expect(result.query).toBe(sampleInput.productName);
      expect(result.source).toBe("raw");
    });

    it("should fall back when LLM returns empty response", async () => {
      mockGenerateContent.mockImplementationOnce(() =>
        Promise.resolve({ text: "" })
      );

      const result = await generateSearchQuerySafe(
        sampleInput,
        "gemini/gemini-2.0-flash-lite",
        { geminiApiKey: "test-key", openaiApiKey: "" }
      );

      expect(result.query).toBe(sampleInput.productName);
      expect(result.source).toBe("raw");
    });
  });
});
