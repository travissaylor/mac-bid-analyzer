# LLM Prompts

[← Back to Project](./PROJECT.md)

## Gemini Fallback Prompt (automated)

Used when eBay returns fewer than 5 sold comps. The response is stored as an advisory estimate — no max bid recommendation is generated.

```
You are a secondary market pricing expert. Estimate the current resale value of this product based on your knowledge of typical pricing for this type of item.

Product: {product_name}
UPC: {upc}
Condition: {condition}
Retail Price: ${retail_price}
Category: {category}
Description: {description}

Provide your estimate as a JSON object with three fields:
- "low": the low end of what this typically sells for in this condition
- "mid": your best estimate of the typical selling price
- "high": the high end of what this typically sells for in this condition

Consider:
- The specific condition listed (new, open box, etc.)
- Typical depreciation for this product category
- Whether this is a commodity item (many sellers) or niche (few sellers)

Respond ONLY with the JSON object, no explanation.
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
