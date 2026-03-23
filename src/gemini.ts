import { GoogleGenAI } from "@google/genai";

export interface GeminiEstimate {
  low: number;
  mid: number;
  high: number;
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
{"low": <number>, "mid": <number>, "high": <number>}

Where:
- "low" is the low end of what this would sell for
- "mid" is the most likely selling price
- "high" is the high end of what this would sell for

All values should be in USD as numbers (no dollar signs).`;
}

export async function getGeminiEstimate(
  apiKey: string,
  input: GeminiInput
): Promise<GeminiEstimate> {
  const prompt = buildPrompt(input);

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
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
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from Gemini response: ${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (
    typeof parsed.low !== "number" ||
    typeof parsed.mid !== "number" ||
    typeof parsed.high !== "number"
  ) {
    throw new Error(`Invalid Gemini estimate format: ${JSON.stringify(parsed)}`);
  }

  return {
    low: parsed.low,
    mid: parsed.mid,
    high: parsed.high,
  };
}
