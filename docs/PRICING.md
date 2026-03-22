# Pricing and Fee Structure

[← Back to Project](./PROJECT.md)

## Mac.bid Cost Breakdown

When you win an item at bid price **X**:

| Fee | Amount | Charged on |
|-----|--------|------------|
| Winning bid | X | — |
| Buyer's premium | X * 15% | Bid price |
| Lot fee | $3.00 flat | Per item |
| Sales tax | X * local rate | Bid price only (not on premium or lot fee) |
| Transfer fee | $10.00 | If transferring to another building |

**Total cost = X + (X * 0.15) + $3.00 + (X * tax_rate) + location_cost**

Simplified: **Total = X * (1 + 0.15 + tax_rate) + $3.00 + location_cost**

### Sales Tax Rates (relevant buildings)

| Building | Location | Tax Rate |
|----------|----------|----------|
| Robinson | Pittsburgh, PA | 6% |
| Monroeville | Pittsburgh, PA | 6% |
| Pittsburgh Mills | Pittsburgh, PA | 6% |
| Washington | Washington, PA | 6% |

Tax rates are fetched dynamically from `GET /buildings` → `sales_tax` field.

### Location Cost Tiers

| Tier | Buildings | Extra Cost | How determined |
|------|-----------|------------|----------------|
| Home | Robinson, Monroeville, Pittsburgh Mills, Washington | $0 | `home_building_ids` in config |
| Transfer | Buildings reachable via transfer from home buildings | $10 | Auto-derived from `/buildings` API `transfer_destinations` |
| Remote | All other buildings | $25 | Default for anything not home or transfer |

Transfer-eligible buildings are derived at runtime: for each home building, parse its `transfer_destinations` field, collect all unique building IDs. Any building in that set is "transfer" tier.

## Max Bid Formula

**Goal:** Pay no more than 70% of the eBay secondary market median price, all-in.

```
target_all_in = ebay_sold_median * 0.70
max_bid = (target_all_in - lot_fee - location_cost) / (1 + buyers_premium_rate + sales_tax_rate)
```

### Example Calculation

**Item:** Ninja Blender, OPEN BOX
- eBay sold median: $55.00
- Building: Robinson (tax: 6%)
- Location tier: Home ($0 extra)

```
target_all_in = $55.00 * 0.70 = $38.50
max_bid = ($38.50 - $3.00 - $0.00) / (1 + 0.15 + 0.06)
max_bid = $35.50 / 1.21
max_bid = $29.34
```

**Verification:**
- Bid: $29.34
- Buyer's premium: $29.34 * 0.15 = $4.40
- Lot fee: $3.00
- Sales tax: $29.34 * 0.06 = $1.76
- **Total: $38.50** (= 70% of $55.00)

### Example with Transfer

Same item, but at a transfer-eligible location:

```
target_all_in = $55.00 * 0.70 = $38.50
max_bid = ($38.50 - $3.00 - $10.00) / 1.21
max_bid = $25.50 / 1.21
max_bid = $21.07
```

### Example with Remote Location

Same item, at a remote location:

```
target_all_in = $55.00 * 0.70 = $38.50
max_bid = ($38.50 - $3.00 - $25.00) / 1.21
max_bid = $10.50 / 1.21
max_bid = $8.68
```

### Edge Cases

- **Max bid calculates to $0 or negative:** The item isn't worth bidding on at this location given fees. Store analysis but flag as "not worth it."
- **No eBay comps (< 5 sold):** Don't calculate max bid. Fall back to Gemini for advisory estimate. Flag as "LLM estimate — manual review."
- **Condition is USED/SALVAGE/DAMAGED:** Don't calculate max bid. Flag as "needs manual review" regardless of eBay comp count.

## Condition Handling

| Condition | Auto-recommend? | Notes |
|-----------|----------------|-------|
| NEW | Yes | Use eBay sold median as-is |
| LIKE NEW | Yes | Use eBay sold median (filter eBay by "like new" if possible) |
| OPEN BOX | Yes | Use eBay sold median (filter eBay by "open box" if possible) |
| USED | No — manual review | Too variable; flag for user |
| SALVAGE | No — manual review | Value depends on specific damage/parts |
| DAMAGED | No — manual review | Value depends on specific damage/parts |

## Configurable Parameters

All pricing parameters are in `config.json` with CLI flag overrides:

| Parameter | Default | Config key | CLI flag |
|-----------|---------|------------|----------|
| Discount threshold | 30% | `discount_threshold` | `--threshold` |
| Lot fee | $3.00 | `lot_fee` | — |
| Buyer's premium | 15% | `buyers_premium_rate` | — |
| Min eBay comps | 5 | `min_ebay_comps` | — |
| Transfer cost | $10.00 | `location_tiers.transfer.extra_cost` | — |
| Remote cost | $25.00 | `location_tiers.remote.extra_cost` | — |
