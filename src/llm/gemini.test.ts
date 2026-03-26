import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { LLMInput } from "./index";

// Mock the @google/genai module before importing the adapter
const mockGenerateContent = mock(() =>
  Promise.resolve({
    text: JSON.stringify({
      low: 35,
      mid: 50,
      high: 65,
      confidence: 82,
      reasoning: "Based on similar blenders",
      comparables: [{ name: "Ninja BL610", estimatedPrice: 45 }],
    }),
  })
);

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
    };
  },
}));

// Import after mocking
const { GeminiProvider } = await import("./gemini");

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

describe("GeminiProvider", () => {
  beforeEach(() => {
    mockGenerateContent.mockClear();
  });

  it("should implement LLMProvider interface and return parsed estimate", async () => {
    const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
    const result = await provider.estimate(sampleInput);

    expect(result.low).toBe(35);
    expect(result.mid).toBe(50);
    expect(result.high).toBe(65);
    expect(result.confidence).toBe(82);
    expect(result.reasoning).toBe("Based on similar blenders");
    expect(result.comparables).toEqual([{ name: "Ninja BL610", estimatedPrice: 45 }]);
  });

  it("should call Gemini with correct parameters", async () => {
    const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
    await provider.estimate(sampleInput);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = (mockGenerateContent.mock.lastCall as unknown[])[0] as Record<string, unknown>;
    expect(callArgs.model).toBe("gemini-2.5-flash");
    expect(callArgs.contents).toContain("Ninja Blender NJ600");
    const config = callArgs.config as Record<string, unknown>;
    expect(config.temperature).toBe(0.1);
  });

  it("should throw when Gemini returns no text", async () => {
    mockGenerateContent.mockImplementationOnce(() =>
      Promise.resolve({ text: null as unknown as string })
    );

    const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
    expect(provider.estimate(sampleInput)).rejects.toThrow("Gemini returned no text content");
  });

  it("should throw when Gemini returns invalid JSON", async () => {
    mockGenerateContent.mockImplementationOnce(() =>
      Promise.resolve({ text: "not json at all" })
    );

    const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
    expect(provider.estimate(sampleInput)).rejects.toThrow("Could not parse JSON");
  });

  it("should handle markdown-wrapped JSON responses", async () => {
    mockGenerateContent.mockImplementationOnce(() =>
      Promise.resolve({
        text: '```json\n{"low": 20, "mid": 30, "high": 40, "confidence": 70, "reasoning": "test", "comparables": []}\n```',
      })
    );

    const provider = new GeminiProvider("test-key", "gemini-2.5-flash");
    const result = await provider.estimate(sampleInput);

    expect(result.low).toBe(20);
    expect(result.mid).toBe(30);
    expect(result.high).toBe(40);
  });
});
