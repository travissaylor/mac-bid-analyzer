import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { LLMInput } from "./index";

// Mock the OpenAI module before importing the adapter
const mockCreate = mock(() =>
  Promise.resolve({
    choices: [
      {
        message: {
          content: JSON.stringify({
            low: 35,
            mid: 50,
            high: 65,
            confidence: 82,
            reasoning: "Based on similar blenders",
            comparables: [{ name: "Ninja BL610", estimatedPrice: 45 }],
          }),
        },
      },
    ],
  })
);

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

// Import after mocking
const { OpenAIProvider } = await import("./openai");

const sampleInput: LLMInput = {
  productName: "Ninja Blender NJ600",
  upc: "012345678901",
  condition: "OPEN BOX",
  retailPrice: 79.99,
  category: "Kitchen",
  description: "Professional blender",
  ebaySoldMedian: null,
  ebaySoldCount: null,
};

describe("OpenAIProvider", () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it("should implement LLMProvider interface and return parsed estimate", async () => {
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");
    const result = await provider.estimate(sampleInput);

    expect(result.low).toBe(35);
    expect(result.mid).toBe(50);
    expect(result.high).toBe(65);
    expect(result.confidence).toBe(82);
    expect(result.reasoning).toBe("Based on similar blenders");
    expect(result.comparables).toEqual([{ name: "Ninja BL610", estimatedPrice: 45 }]);
  });

  it("should call OpenAI with correct parameters", async () => {
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");
    await provider.estimate(sampleInput);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = (mockCreate.mock.lastCall as unknown[])[0] as Record<string, unknown>;
    expect(callArgs.model).toBe("gpt-4o-mini");
    expect(callArgs.temperature).toBe(0.1);
    expect(callArgs.response_format).toEqual({ type: "json_object" });
    expect(callArgs.messages).toBeArrayOfSize(2);
    const messages = callArgs.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("Ninja Blender NJ600");
  });

  it("should throw when OpenAI returns empty response", async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: null as unknown as string } }],
      })
    );

    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");
    expect(provider.estimate(sampleInput)).rejects.toThrow("OpenAI returned an empty response");
  });

  it("should throw when OpenAI returns invalid JSON", async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: "not json" } }],
      })
    );

    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");
    expect(provider.estimate(sampleInput)).rejects.toThrow("Could not parse JSON");
  });
});
