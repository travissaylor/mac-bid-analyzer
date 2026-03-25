import { describe, expect, it } from "bun:test";
import { parseModelString, getApiKeyForProvider, createProvider } from "./index";

describe("llm/index", () => {
  describe("parseModelString", () => {
    it("should parse openai/gpt-4o-mini", () => {
      const result = parseModelString("openai/gpt-4o-mini");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("should parse gemini/gemini-2.5-flash", () => {
      const result = parseModelString("gemini/gemini-2.5-flash");
      expect(result.provider).toBe("gemini");
      expect(result.model).toBe("gemini-2.5-flash");
    });

    it("should handle model names with multiple slashes", () => {
      const result = parseModelString("openai/ft:gpt-4o-mini/custom");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("ft:gpt-4o-mini/custom");
    });

    it("should throw on string without slash", () => {
      expect(() => parseModelString("gpt-4o-mini")).toThrow('expected "provider/model-name" format');
    });

    it("should throw on empty string", () => {
      expect(() => parseModelString("")).toThrow('expected "provider/model-name" format');
    });
  });

  describe("getApiKeyForProvider", () => {
    const env = {
      geminiApiKey: "gem-key-123",
      openaiApiKey: "oai-key-456",
    };

    it("should return OpenAI key for openai provider", () => {
      expect(getApiKeyForProvider("openai", env)).toBe("oai-key-456");
    });

    it("should return Gemini key for gemini provider", () => {
      expect(getApiKeyForProvider("gemini", env)).toBe("gem-key-123");
    });

    it("should return null for unknown provider", () => {
      expect(getApiKeyForProvider("anthropic", env)).toBeNull();
    });

    it("should return null when openai key is empty", () => {
      expect(getApiKeyForProvider("openai", { ...env, openaiApiKey: "" })).toBeNull();
    });

    it("should return null when gemini key is empty", () => {
      expect(getApiKeyForProvider("gemini", { ...env, geminiApiKey: "" })).toBeNull();
    });
  });

  describe("createProvider", () => {
    it("should create an OpenAI provider", async () => {
      const provider = await createProvider("openai", "gpt-4o-mini", "test-key");
      expect(provider).toBeDefined();
      expect(typeof provider.estimate).toBe("function");
    });

    it("should create a Gemini provider", async () => {
      const provider = await createProvider("gemini", "gemini-2.5-flash", "test-key");
      expect(provider).toBeDefined();
      expect(typeof provider.estimate).toBe("function");
    });

    it("should throw for unsupported provider", async () => {
      expect(createProvider("anthropic", "claude-3", "test-key")).rejects.toThrow(
        'Unsupported LLM provider: "anthropic"'
      );
    });
  });
});
