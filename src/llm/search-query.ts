import { parseModelString, getApiKeyForProvider } from "./index";

const SEARCH_QUERY_PROMPT = `Extract an optimized eBay search query from the given product information.

Rules:
- Return ONLY the search query string, nothing else — no quotes, no explanation, no JSON
- Include brand name, model number, and product type
- Strip marketing fluff, noise words, condition descriptions, and promotional language
- Keep it concise — just the essential identifying terms
- If a model number is present, always include it
- Do NOT include condition, price, quantity, or seller info

Examples:
Product: Ninja Professional Blender NJ600 - Brand New in Box! Great for Smoothies
Output: Ninja NJ600 Professional Blender

Product: Apple MacBook Pro 14-inch M3 Pro 18GB 512GB Space Black - AMAZING DEAL
Output: Apple MacBook Pro 14 M3 Pro 18GB 512GB

Product: COZYDESG 3-Tier Rolling Cart Storage Organizer - Perfect for Kitchen/Bathroom!
Output: COZYDESG 3-Tier Rolling Cart Storage Organizer`;

export interface SearchQueryInput {
  productName: string;
  description: string | null;
  upc: string | null;
  category: string | null;
  condition: string;
}

function buildSearchQueryUserPrompt(input: SearchQueryInput): string {
  return [
    `Product: ${input.productName}`,
    input.description ? `Description: ${input.description}` : null,
    input.upc ? `UPC: ${input.upc}` : null,
    input.category ? `Category: ${input.category}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateSearchQuery(
  input: SearchQueryInput,
  provider: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const userPrompt = buildSearchQueryUserPrompt(input);

  if (provider === "gemini") {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: `${SEARCH_QUERY_PROMPT}\n\n${userPrompt}`,
      config: { temperature: 0.0 },
    });

    const text = response.text?.trim();
    if (!text || text.length < 3) {
      throw new Error("LLM returned empty or too-short search query");
    }
    return text;
  } else if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SEARCH_QUERY_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.0,
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text || text.length < 3) {
      throw new Error("LLM returned empty or too-short search query");
    }
    return text;
  }

  throw new Error(`Unsupported provider for search query generation: ${provider}`);
}

/**
 * Generate an optimized eBay search query using the configured LLM provider.
 * Falls back to the raw product name if the LLM call fails.
 */
export async function generateSearchQuerySafe(
  input: SearchQueryInput,
  llmModel: string,
  env: { geminiApiKey: string; openaiApiKey: string },
): Promise<{ query: string; source: "llm" | "raw" }> {
  const { provider, model } = parseModelString(llmModel);
  const apiKey = getApiKeyForProvider(provider, env);

  if (!apiKey) {
    return { query: input.productName, source: "raw" };
  }

  try {
    const query = await generateSearchQuery(input, provider, model, apiKey);
    return { query, source: "llm" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] Search query generation failed: ${message}. Falling back to product name.`);
    return { query: input.productName, source: "raw" };
  }
}

export { SEARCH_QUERY_PROMPT, buildSearchQueryUserPrompt };
