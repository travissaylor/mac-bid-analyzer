# LLM Prompts

[← Back to Project](./PROJECT.md)

The tool uses LLMs for three automated tasks: price estimation, image analysis, and eBay search query generation. All prompts work with any configured provider (OpenAI or Gemini) via the unified provider abstraction in `src/llm/`.

## Price Estimation Prompt (automated)

Used for every analyzed item. When eBay returns comps, the LLM receives them as context to calibrate its estimate. When there are fewer than 5 comps, the LLM estimate becomes the primary signal.

**Source:** `src/llm/prompt.ts`

### System Prompt

```
You are a pricing expert. Estimate the secondary market value (what this item would sell for on eBay as a completed/sold listing) for the following product.

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

All price values should be in USD as numbers (no dollar signs).
```

### User Prompt (dynamically built)

Includes: product name, UPC, condition, retail price, category, description, eBay sold data (if available), eBay search provenance (strategy, query, whether filters were relaxed), and image red flags (if image analysis found issues).

## Image Analysis Prompt (automated)

Used during analysis when actual product photos (beyond the stock image) are available. Findings feed into the price estimation prompt as red flags and may trigger manual review.

**Source:** `src/llm/image-prompt.ts`

### System Prompt

```
You are a product condition inspector. You are given photos of an item being sold at auction. Your job is to identify physical defects, missing parts, and mismatches between the product listing and what is shown in the photos.

Image numbering: Image 0 is the stock/reference image. Images 1+ are actual product photos taken of the specific item being sold.

Look for:
1. Physical damage — cracks, dents, scratches, scuffs, water damage, discoloration, broken parts, bent components. Severity guide:
   - high: Cracked screen, significant dents, water damage, broken structural parts
   - medium: Noticeable scratches, minor dents on visible surfaces, cosmetic damage
   - low: Hairline scratches, minor scuffs, light wear marks

2. Missing parts or accessories — empty slots, missing cables, missing stands, missing covers or panels, absent accessories that should be included. Severity guide:
   - high: Key functional components missing (e.g., power adapter for laptop, remote for TV)
   - medium: Notable accessories missing (e.g., stylus, extra cables, documentation)
   - low: Minor accessories missing (e.g., extra ear tips, cable ties)

3. Mismatch — the actual product photos don't match the stock image or product name. The item shown is a different model, color, size, or product entirely. Severity guide:
   - high: Completely different product, wrong model number, obviously different item
   - medium: Same product line but different variant (wrong color, different size)
   - low: Minor discrepancy (slightly different revision, updated packaging)

If the photos appear to all be stock/generic marketing images (no actual product-specific photos showing the real item), set "stockImageOnly" to true and return an empty findings array.

Respond with ONLY a JSON object in this exact format, no other text:
{"findings": [{"type": "<damage|missing_parts|mismatch>", "severity": "<high|medium|low>", "description": "<string>", "imageIndex": <number>}], "overallRisk": <number 0-100>, "stockImageOnly": <boolean>}
```

### Severity Penalties

Image findings reduce the LLM confidence score:

| Severity | Penalty |
|----------|---------|
| high | -20 |
| medium | -10 |
| low | -5 |

## Search Query Generation Prompt (automated)

Used before eBay search to generate an optimized query from the product listing data. Falls back to raw product name if the LLM call fails.

**Source:** `src/llm/search-query.ts`

```
Extract an optimized eBay search query from the given product information.

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
Output: COZYDESG 3-Tier Rolling Cart Storage Organizer
```

## Manual Review Prompts (for your own use)

These are prompts you can paste into any LLM chat when reviewing items flagged as USED/SALVAGE/DAMAGED.

### Salvage Item — Is It Worth Anything?

```
I'm considering bidding on a salvage-condition item at a liquidation auction. Help me assess whether it has residual value.

Product: [product name]
Category: [category]
Retail Price: $[retail price]
Description from auction: [paste mac.bid description]

Questions:
1. What are the most valuable components/parts in this product?
2. If the item is non-functional, what could the parts sell for individually?
3. If the item has cosmetic damage but works, what would it sell for as-is?
4. What's the most likely reason this item was marked "salvage"?
5. What's the maximum you'd recommend paying for this item at auction, assuming worst-case condition?
```

### Damaged Item — Repair Cost Assessment

```
I'm looking at a damaged-condition item at a liquidation auction. Help me figure out if it's worth repairing.

Product: [product name]
Category: [category]
Retail Price: $[retail price]
Working used price on eBay: $[if you looked it up]
Description from auction: [paste mac.bid description]

Questions:
1. What are the most common types of damage for this product?
2. For each damage type, what's the typical repair cost (DIY vs professional)?
3. Are replacement parts readily available and affordable?
4. At what bid price does this become worth it if I have to spend $[X] on repairs?
5. Are there any damage types that would make this item worthless (unrepairable)?
```

### Used Item — Condition-Adjusted Valuation

```
I'm bidding on a used-condition item at a liquidation auction. Help me set a fair maximum bid.

Product: [product name]
Category: [category]
Retail Price: $[retail price]
eBay sold prices for this item (any condition): $[low] - $[high], median $[mid]
Number of eBay comps found: [N]
Description from auction: [paste mac.bid description]

The auction listing says "USED" but doesn't specify further. For this type of product:
1. What condition range does "used" typically mean in liquidation?
2. What percentage of the working-condition price should I expect for a used unit?
3. What should I look for when I pick it up to verify it's functional?
4. Recommended maximum bid (factoring in that my all-in cost will be bid + 15% premium + $3 lot fee + 6% sales tax on the bid)?
```

### Generic "Is This a Good Deal?" Prompt

```
I found this item at a liquidation auction. It starts at $1 and I need to decide my maximum bid.

Product: [product name]
Condition: [condition]
Retail Price: $[retail price]
Current Bid: $[current bid]
My all-in cost formula: bid * 1.21 + $3.00 + $[0/10/25 location cost]

What would this item realistically sell for on Facebook Marketplace in [your city]?
What would it sell for on eBay?
What's a fair price to pay for personal use (not reselling)?

I want to pay at least 30% less than what I'd pay buying it used elsewhere.
```
