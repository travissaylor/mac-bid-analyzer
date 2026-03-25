import type { LLMInput, LLMEstimate, LLMComparable } from "./index";

export const SYSTEM_PROMPT = `You are a pricing expert. Estimate the secondary market value (what this item would sell for on eBay as a completed/sold listing) for the following product.

IMPORTANT — Do NOT anchor your estimate to the retail price. Retail price is provided as context only. Secondary market values are often 10–50% of retail, especially for generic brands and home goods. If eBay sold data is provided, weight it heavily as the most reliable signal.

Brand recognition matters: Unknown or generic brands (e.g., "Kevinplus", "COZYDESG", "RONGSHU") have significantly lower resale value than established brands (e.g., Apple, Logitech, GIGABYTE). If you don't recognize the brand, assume low demand and price accordingly.

Category-specific depreciation: Furniture and home goods depreciate heavily on the secondary market — buyers expect deep discounts. Well-known electronics brands retain more value relative to retail.

Condition guidance: "Open Box" and "As-Is" items sell for less than new. Factor the stated condition into your estimate but do not apply fixed percentage rules — use your judgment based on the category and brand.

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

export function buildUserPrompt(input: LLMInput): string {
  const ebayLine =
    input.ebaySoldCount && input.ebaySoldCount > 0 && input.ebaySoldMedian && input.ebaySoldMedian > 0
      ? `eBay Sold Median: $${input.ebaySoldMedian.toFixed(2)} (${input.ebaySoldCount} recent sales)`
      : `eBay Comps: No completed sales found`;

  return [
    `Product: ${input.productName}`,
    input.upc ? `UPC: ${input.upc}` : null,
    `Condition: ${input.condition}`,
    input.retailPrice !== null ? `Retail Price: $${input.retailPrice.toFixed(2)}` : null,
    input.category ? `Category: ${input.category}` : null,
    input.description ? `Description: ${input.description}` : null,
    ebayLine,
  ].filter(Boolean).join("\n");
}

export function buildPrompt(input: LLMInput): string {
  return `${SYSTEM_PROMPT}\n\n${buildUserPrompt(input)}`;
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

/** Parse and validate an LLM JSON response into an LLMEstimate. */
export function parseEstimateResponse(text: string): LLMEstimate {
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    throw new Error(`Could not parse JSON from LLM response: ${text}`);
  }

  const parsed = JSON.parse(jsonStr);

  if (
    typeof parsed.low !== "number" ||
    typeof parsed.mid !== "number" ||
    typeof parsed.high !== "number"
  ) {
    throw new Error(`Invalid LLM estimate format: ${JSON.stringify(parsed)}`);
  }

  let comparables: LLMComparable[] | null = null;
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
