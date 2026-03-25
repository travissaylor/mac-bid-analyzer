export interface LLMComparable {
  name: string;
  estimatedPrice: number;
}

export interface LLMEstimate {
  low: number;
  mid: number;
  high: number;
  confidence: number | null;
  reasoning: string | null;
  comparables: LLMComparable[] | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMInput {
  productName: string;
  upc: string | null;
  condition: string;
  retailPrice: number | null;
  category: string | null;
  description: string | null;
}

export interface LLMProvider {
  estimate(input: LLMInput): Promise<LLMEstimate>;
}

/**
 * Parse a "provider/model-name" string into its components.
 */
export function parseModelString(modelString: string): { provider: string; model: string } {
  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model string "${modelString}" — expected "provider/model-name" format`);
  }
  return {
    provider: modelString.slice(0, slashIndex),
    model: modelString.slice(slashIndex + 1),
  };
}

/**
 * Resolve the API key for a given provider from the environment config.
 * Returns null if the key is not set.
 */
export function getApiKeyForProvider(
  provider: string,
  env: { geminiApiKey: string; openaiApiKey: string }
): string | null {
  switch (provider) {
    case "openai":
      return env.openaiApiKey || null;
    case "gemini":
      return env.geminiApiKey || null;
    default:
      return null;
  }
}

/**
 * Create an LLMProvider instance for the given provider and model.
 */
export async function createProvider(
  provider: string,
  model: string,
  apiKey: string
): Promise<LLMProvider> {
  switch (provider) {
    case "openai": {
      const { OpenAIProvider } = await import("./openai");
      return new OpenAIProvider(apiKey, model);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini");
      return new GeminiProvider(apiKey, model);
    }
    default:
      throw new Error(`Unsupported LLM provider: "${provider}"`);
  }
}
