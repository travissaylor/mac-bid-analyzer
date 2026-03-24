# RFC: Unify Display Formatting into a Deep `format.ts` Module

**Status:** Proposed
**Date:** 2026-03-24
**Cluster:** `cli.ts`, `analyze.ts`, `telegram.ts`

## Problem

Display formatting for `AnalyzedItem` data is duplicated across three files with five functions:

| Function | File | Format | Lines |
|---|---|---|---|
| `formatResultsTable` | cli.ts | Plain text table | ~40 |
| `printItemDetail` | cli.ts | Plain text detail | ~70 |
| `printAnalysisSummary` | analyze.ts | Plain text summary | ~70 |
| `formatSummaryHtml` | telegram.ts | Telegram HTML compact | ~40 |
| `formatDetailHtml` | telegram.ts | Telegram HTML full | ~90 |
| `formatActiveOverviewHtml` | telegram.ts | Telegram HTML list | ~40 |

All six implement the same business logic decisions independently:

1. **Max bid classification**: `null` -> "N/A", `<= 0` -> "NOT WORTH IT", `> 0` -> formatted value
2. **Deal score formatting**: `null` -> "N/A", otherwise `Math.round(score) + "%"`
3. **eBay comps gating**: only display when `ebay_sold_count > 0`
4. **AI estimate gating**: only display when `llm_provider` exists AND `llm_estimate_mid !== null`
5. **Manual review warning**: show when `needs_manual_review === true`, with reason
6. **Deal determination**: `current_bid <= recommended_max_bid && max_bid > 0`
7. **Comparables parsing**: `JSON.parse(llm_comparables)` with try/catch, duplicated 3x
8. **Price formatting**: `$${x.toFixed(2)}` scattered throughout

Any change to display logic (e.g., adding a new threshold label, changing "NOT WORTH IT" text) requires updating multiple files. The Telegram formatters are entirely untested. Future output targets (Ntfy notifications, TUI) would duplicate this further.

## Design

### Architecture: View Model + Renderer Interface + Convenience Wrappers

Three layers:

```
AnalyzedItem (db.ts)
       |
       v
resolveDisplayData()  -->  ItemDisplayData (structured, typed, business logic resolved)
       |
       v
ItemRenderer<T>  -->  plainText / telegramHtml / future renderers
       |
       v
to*() wrappers  -->  one-liner convenience for callers
```

### New file: `src/format.ts`

#### Layer 1: View Model

```typescript
import type { AnalyzedItem } from "./db";

export interface Comparable {
  name: string;
  estimatedPrice: number;
}

export interface ItemDisplayData {
  // Identity
  lotId: number;
  productName: string;
  condition: string;
  currentBid: number;
  totalBids: number;
  isOpen: boolean;
  auctionLocation: string;
  locationTier: string;
  locationCost: number;
  analyzedAt: string;
  analysisSource: string;

  // eBay (null = no comps found)
  ebay: {
    median: number;
    low: number;
    high: number;
    count: number;
    searchQuery: string | null;
  } | null;

  // AI estimate (null = no AI data)
  ai: {
    provider: string;
    low: number;
    mid: number;
    high: number;
    confidence: number | null;
    reasoning: string | null;
    comparables: Comparable[];
  } | null;

  // Recommendation (discriminated union)
  maxBid:
    | { type: "value"; amount: number }
    | { type: "not_worth_it"; amount: number }
    | { type: "unavailable" };

  dealScore: number | null;
  salesTaxRate: number | null;

  // Flags
  manualReview: { reason: string } | null;
  isDeal: boolean;
  isOverMax: boolean;

  // Blended source info (for cost breakdown views)
  blend: { ebayMedian: number; aiMid: number } | null;
}

export function resolveDisplayData(item: AnalyzedItem): ItemDisplayData;
```

`resolveDisplayData` is a pure function. It encapsulates all 8 business logic rules listed above. No I/O, no side effects, no runtime dependencies beyond the `AnalyzedItem` type.

#### Layer 2: Renderer Interface

```typescript
export interface ItemRenderer<T = string> {
  summary?(data: ItemDisplayData): T;
  detail?(data: ItemDisplayData): T;
  tableRow?(data: ItemDisplayData): T;
  table?(items: ItemDisplayData[]): T;
  activeOverview?(items: ItemDisplayData[]): T;
}

export const plainText: ItemRenderer<string>;
export const telegramHtml: ItemRenderer<string>;
```

Renderers are plain objects implementing optional methods. They contain zero business logic -- they read pre-computed fields from `ItemDisplayData` and produce formatted output. `escapeHtml` moves into `format.ts` as a private helper used only by `telegramHtml`.

New renderers (Ntfy, Markdown, TUI) implement the interface in their own files without touching `format.ts`.

#### Layer 3: Convenience Wrappers

```typescript
export function toTextSummary(item: AnalyzedItem): string;
export function toTextDetail(item: AnalyzedItem): string;
export function toTextTableRow(item: AnalyzedItem): string;
export function toHtmlSummary(item: AnalyzedItem): string;
export function toHtmlDetail(item: AnalyzedItem): string;
export function toHtmlActiveOverview(items: AnalyzedItem[]): string;
```

Each is a one-liner: `(item) => renderer.method(resolveDisplayData(item))`. These exist so the most common call sites remain single expressions.

### Caller Changes

**cli.ts** (results table):
```typescript
// Before
console.log(formatResultsTable(items));  // 40-line function defined inline

// After
import { resolveDisplayData, plainText } from "./format";
const rows = items.map(i => plainText.tableRow!(resolveDisplayData(i)));
// or use toTextTableRow for individual items
```

**cli.ts** (item detail):
```typescript
// Before
printItemDetail(item);  // 70-line function defined inline

// After
import { toTextDetail } from "./format";
console.log(toTextDetail(item));
```

**analyze.ts** (post-analysis summary):
```typescript
// Before
printAnalysisSummary(result);  // 70-line function defined inline

// After
import { toTextSummary } from "./format";
export function printAnalysisSummary(result: AnalyzeResult): void {
  console.log(result.skipped ? "--- Existing Analysis ---" : "--- Analysis Complete ---");
  console.log(toTextSummary(result.item));
}
```

Note: the `skipped` header stays in the caller -- it's context the formatter shouldn't own.

**telegram.ts**:
```typescript
// Before
const html = formatSummaryHtml(item);     // 40-line function
const html = formatDetailHtml(item);      // 90-line function
const html = formatActiveOverviewHtml(items);  // 40-line function

// After
import { toHtmlSummary, toHtmlDetail, toHtmlActiveOverview } from "./format";
const html = toHtmlSummary(item);
const html = toHtmlDetail(item);
const html = toHtmlActiveOverview(items);
```

### Future renderer example (Ntfy notifications):

```typescript
// src/ntfy-renderer.ts
import type { ItemRenderer, ItemDisplayData } from "./format";

export const ntfyRenderer: ItemRenderer<string> = {
  summary(d) {
    const maxBid = d.maxBid.type === "value" ? `$${d.maxBid.amount.toFixed(2)}`
                 : d.maxBid.type === "not_worth_it" ? "NOT WORTH IT"
                 : "N/A";
    return `${d.productName}\nBid: $${d.currentBid.toFixed(2)} | Max: ${maxBid}`;
  },
};
```

Zero changes to `format.ts` required.

## Dependency Graph

```
Before:
  cli.ts ──────> db.ts (AnalyzedItem)
  analyze.ts ──> db.ts (AnalyzedItem)
  telegram.ts ─> db.ts (AnalyzedItem)
  (business logic duplicated in all three)

After:
  format.ts ───> db.ts (type-only import: AnalyzedItem)
  cli.ts ──────> format.ts
  analyze.ts ──> format.ts
  telegram.ts ─> format.ts
  (business logic centralized in format.ts)
```

`format.ts` has one type-only import. No database, no network, no Telegraf, no config.

## Test Strategy

### New tests: `src/format.test.ts`

**`resolveDisplayData` tests** (replace scattered business logic tests):
- Max bid: null item -> `{ type: "unavailable" }`
- Max bid: negative -> `{ type: "not_worth_it", amount: -2.50 }`
- Max bid: positive -> `{ type: "value", amount: 42.00 }`
- eBay: count 0 -> `ebay: null`
- eBay: count > 0 -> populated object
- AI: no provider -> `ai: null`
- AI: provider + mid -> populated object with parsed comparables
- Comparables: invalid JSON -> empty array
- Deal flags: various current_bid vs max_bid combinations
- Manual review: true with reason, true with null reason -> "Unknown reason"

**Renderer tests** (pure string assertions):
- `plainText.summary(data)` contains expected labels and values
- `telegramHtml.summary(data)` contains HTML tags, escaped product names
- `telegramHtml.detail(data)` includes cost breakdown section
- HTML output does not contain unescaped `<`, `>`, `&` in product names

**Replaced tests**: Display-specific assertions currently in `cli.test.ts` and `analyze.test.ts` can be simplified to verify they call the right formatter, rather than testing formatting logic inline.

## Migration Plan

1. Create `src/format.ts` with `resolveDisplayData`, `plainText`, `telegramHtml`, and `to*` wrappers
2. Create `src/format.test.ts` covering all 8 business logic rules and both renderers
3. Replace `formatResultsTable` and `printItemDetail` in `cli.ts` with imports from `format.ts`
4. Replace `printAnalysisSummary` body in `analyze.ts`
5. Replace `formatSummaryHtml`, `formatDetailHtml`, `formatActiveOverviewHtml`, and `escapeHtml` in `telegram.ts`
6. Remove dead formatting code from all three files
7. Verify all existing tests pass; update assertions that checked specific formatting strings

Each step can be a separate commit. Steps 3-5 are independent and can be done in any order.

## Trade-offs

**Gains:**
- 8 business logic rules defined once instead of 3-5 times each
- Telegram formatting becomes testable (currently 0% coverage)
- New output formats require zero changes to existing code
- Discriminated union for max bid catches exhaustiveness errors at compile time
- ~250 lines of duplicated formatting logic removed from cli.ts, analyze.ts, telegram.ts

**Costs:**
- New intermediate type (`ItemDisplayData`) to maintain alongside `AnalyzedItem`
- Developers must learn the resolve-then-render pattern (mitigated by `to*` wrappers)
- `resolveDisplayData` computes all fields even when a view only needs a few (negligible for current data sizes)
- Renderers could still diverge on which *sections* they show, even though the *values* are guaranteed consistent
