import { GoogleGenAI } from "@google/genai";

export interface GeminiComparable {
  name: string;
  estimatedPrice: number;
}

export interface GeminiEstimate {
  low: number;
  mid: number;
  high: number;
  confidence: number | null;
  reasoning: string | null;
  comparables: GeminiComparable[] | null;
}

export interface GeminiInput {
  productName: string;
  upc: string | null;
  condition: string;
  retailPrice: number | null;
  category: string | null;
  description: string | null;
}

function buildPrompt(input: GeminiInput): string {
  const parts = [
    `Product: ${input.productName}`,
    input.upc ? `UPC: ${input.upc}` : null,
    `Condition: ${input.condition}`,
    input.retailPrice !== null ? `Retail Price: $${input.retailPrice.toFixed(2)}` : null,
    input.category ? `Category: ${input.category}` : null,
    input.description ? `Description: ${input.description}` : null,
  ].filter(Boolean).join("\n");

  return `You are a pricing expert. Estimate the secondary market value (what this item would sell for on eBay as a completed/sold listing) for the following product. Consider the condition when estimating.

${parts}

Respond with ONLY a JSON object in this exact format, no other text:
{"low": <number>, "mid": <number>, "high": <number>, "confidence": <number>, "reasoning": "<string>", "comparables": [{"name": "<string>", "estimatedPrice": <number>}]}

Where:
- "low" is the low end of what this would sell for
- "mid" is the most likely selling price
- "high" is the high end of what this would sell for
- "confidence" is a score from 0 to 100 indicating how confident you are in this estimate (100 = very confident, 0 = wild guess)
- "reasoning" is a brief explanation of how you arrived at this estimate, including key factors considered
- "comparables" is an array of similar products/listings you are basing the estimate on, each with a "name" and "estimatedPrice"

All price values should be in USD as numbers (no dollar signs).`;
}

/** Extract the outermost JSON object from text using brace counting. */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export async function getGeminiEstimate(
  apiKey: string,
  input: GeminiInput,
  model: string = "gemini-2.5-flash"
): Promise<GeminiEstimate> {
  const prompt = buildPrompt(input);

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.1,
    },
  });

  const text = response.text;

  if (!text || typeof text !== "string") {
    throw new Error("Gemini returned no text content");
  }

  // Extract JSON from response (may have markdown code fences)
  // Use brace counting to handle nested objects (comparables array)
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    throw new Error(`Could not parse JSON from Gemini response: ${text}`);
  }

  const parsed = JSON.parse(jsonStr);

  if (
    typeof parsed.low !== "number" ||
    typeof parsed.mid !== "number" ||
    typeof parsed.high !== "number"
  ) {
    throw new Error(`Invalid Gemini estimate format: ${JSON.stringify(parsed)}`);
  }

  // Parse comparables with graceful fallback
  let comparables: GeminiComparable[] | null = null;
  if (Array.isArray(parsed.comparables)) {
    comparables = parsed.comparables
      .filter(
        (c: unknown): c is { name: string; estimatedPrice: number } =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as Record<string, unknown>).name === "string" &&
          typeof (c as Record<string, unknown>).estimatedPrice === "number"
      );
    if (comparables!.length === 0) comparables = null;
  }

  return {
    low: parsed.low,
    mid: parsed.mid,
    high: parsed.high,
    confidence:
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 100
        ? parsed.confidence
        : null,
    reasoning:
      typeof parsed.reasoning === "string" && parsed.reasoning.length > 0
        ? parsed.reasoning
        : null,
    comparables,
  };
}
