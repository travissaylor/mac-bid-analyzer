# PRD: Unify Display Formatting

## 1. Introduction/Overview

Display formatting for `AnalyzedItem` data is duplicated across `cli.ts`, `analyze.ts`, and `telegram.ts` — six functions totaling ~310 lines that independently implement the same 8 business logic rules (max bid classification, deal scoring, eBay/AI gating, etc.). This refactor consolidates all display logic into a single `src/format.ts` module with a view model layer, a renderer interface, and convenience wrappers, eliminating duplication and making Telegram output testable for the first time.

## 2. Goals

- Eliminate duplication of 8 display business logic rules across 3 files
- Establish a single source of truth for how `AnalyzedItem` data is interpreted for display
- Make all display formatting (including Telegram HTML) unit-testable with no mocks
- Normalize CLI and Telegram output for consistency, using Telegram's format as the reference
- Provide an extensible `ItemRenderer` interface for future output targets (Ntfy, TUI)
- Deliver as a single PR with atomic commits per migration step

## 3. User Stories

### US-001: Create the view model and resolver

**Description:** As a developer, I want a single `resolveDisplayData()` function that converts an `AnalyzedItem` into a structured `ItemDisplayData` object so that all display business logic is defined in one place.

**Acceptance Criteria:**

- [ ] `src/format.ts` exists with `resolveDisplayData(item: AnalyzedItem): ItemDisplayData` exported
- [ ] `ItemDisplayData` uses a discriminated union for max bid: `{ type: "value", amount } | { type: "not_worth_it", amount } | { type: "unavailable" }`
- [ ] `ebay` field is `null` when `ebay_sold_count === 0`, populated object otherwise
- [ ] `ai` field is `null` when `llm_provider` is falsy or `llm_estimate_mid` is null, populated object otherwise
- [ ] `ai.comparables` is parsed from the `llm_comparables` JSON string; invalid JSON yields `[]`
- [ ] `isDeal` is `true` only when `current_bid <= recommended_max_bid` and `recommended_max_bid > 0`
- [ ] `isOverMax` is `true` only when `current_bid > recommended_max_bid` and `recommended_max_bid > 0`
- [ ] `manualReview` is `null` when `needs_manual_review` is false; `{ reason }` otherwise (defaulting to `"Unknown reason"` if reason is null)
- [ ] `dealScore` is `Math.round(deal_score)` or `null`
- [ ] `isOpen` converts SQLite integer (0/1) to boolean
- [ ] Function is pure — no I/O, no side effects, no imports beyond `type { AnalyzedItem }`
- [ ] `bun x tsc --noEmit` passes

### US-002: Create the plain text renderer

**Description:** As a CLI user, I want formatted text output for analysis results so that I can read item summaries, details, and tables in my terminal.

**Acceptance Criteria:**

- [ ] `src/format.ts` exports a `plainText` object implementing `ItemRenderer<string>`
- [ ] `plainText.summary(data)` produces a multi-line text summary (product name, condition, bid, eBay/AI data, max bid, deal score, manual review warning)
- [ ] `plainText.detail(data)` produces full detail output with eBay section, AI section (including comparables), cost breakdown, and recommendation
- [ ] `plainText.tableRow(data)` produces a fixed-width row: lot ID (10), product name (40, truncated with "…"), condition (10), bid (8), max bid (10), score (8), status (8)
- [ ] `plainText.table(items)` produces header + separator + rows
- [ ] Max bid displays as "N/A", "NOT WORTH IT", or "$X.XX" depending on discriminated union type
- [ ] Deal score displays as "N/A" or "X%" (no decimals)
- [ ] Currency values formatted as "$X.XX"
- [ ] `bun x tsc --noEmit` passes

### US-003: Create the Telegram HTML renderer

**Description:** As a Telegram user, I want HTML-formatted messages for analysis results so that I can read item summaries, full details, and active item overviews in the Telegram bot.

**Acceptance Criteria:**

- [ ] `src/format.ts` exports a `telegramHtml` object implementing `ItemRenderer<string>`
- [ ] `telegramHtml.summary(data)` produces Telegram-compatible HTML with bold labels, bid count, eBay/AI sections, max bid, deal score, source, and manual review warning
- [ ] `telegramHtml.detail(data)` produces full HTML detail with eBay low/mid/high, AI low/mid/high, confidence, reasoning, comparables as bullet list, cost breakdown (blended line, sales tax, location cost), and recommendation
- [ ] `telegramHtml.activeOverview(items)` produces a header with item/deal counts, items sorted by deal_score descending (nulls last), each showing product name, current bid, max bid, and deal score or "over max" indicator
- [ ] All user-generated text (product names, reasons, reasoning) is HTML-escaped (& < > characters)
- [ ] Output is valid for Telegram's HTML parse mode (only `<b>`, `<i>`, `<code>`, `<a>` tags)
- [ ] `bun x tsc --noEmit` passes

### US-004: Create convenience wrappers

**Description:** As a developer calling format functions, I want one-liner wrappers so that I don't have to call `resolveDisplayData` separately at every call site.

**Acceptance Criteria:**

- [ ] `src/format.ts` exports: `toTextSummary(item)`, `toTextDetail(item)`, `toTextTableRow(item)`, `toHtmlSummary(item)`, `toHtmlDetail(item)`, `toHtmlActiveOverview(items)`
- [ ] Each wrapper calls `resolveDisplayData` internally and delegates to the appropriate renderer method
- [ ] `bun x tsc --noEmit` passes

### US-005: Write format.test.ts

**Description:** As a developer, I want comprehensive tests for the format module so that display business logic and both renderers are verified.

**Acceptance Criteria:**

- [ ] `src/format.test.ts` exists using `bun:test`
- [ ] Tests for `resolveDisplayData`: max bid null/negative/positive, eBay null/populated, AI null/populated, comparables valid JSON/invalid JSON/null, deal flags for various bid vs. max bid combinations, manual review true/false/null-reason
- [ ] Tests for `plainText`: summary contains expected labels, detail contains eBay/AI/recommendation sections, tableRow has correct column widths, table has header + separator + rows
- [ ] Tests for `telegramHtml`: summary contains `<b>` tags around labels, detail contains cost breakdown, activeOverview sorts by deal score, HTML-escaped product names with `&` `<` `>` characters render safely
- [ ] All tests pass via `bun test src/format.test.ts`

### US-006: Migrate CLI callers

**Description:** As a developer, I want to replace the inline formatting functions in `cli.ts` with calls to `format.ts` so that CLI output uses the shared module.

**Acceptance Criteria:**

- [ ] `formatResultsTable` in `cli.ts` is replaced with a call to `plainText.table()` or equivalent using `toTextTableRow`
- [ ] `printItemDetail` in `cli.ts` is replaced with a call to `toTextDetail()`
- [ ] `printAnalysisSummary` is moved from `analyze.ts` to `cli.ts` as a thin wrapper that prints the skipped/complete header, calls `toTextSummary()`, and prints the GOOD DEAL / PASS / MANUAL REVIEW footer
- [ ] `analyze.ts` no longer exports `printAnalysisSummary`
- [ ] `cli.ts` imports from `./format` instead of defining formatting inline
- [ ] CLI output is functionally equivalent (normalized to match Telegram's conventions where they previously differed)
- [ ] All existing tests pass: `bun test`
- [ ] `bun x tsc --noEmit` passes

### US-007: Migrate Telegram callers

**Description:** As a developer, I want to replace the inline formatting functions in `telegram.ts` with calls to `format.ts` so that Telegram output uses the shared module.

**Acceptance Criteria:**

- [ ] `formatSummaryHtml`, `formatDetailHtml`, `formatActiveOverviewHtml`, and `escapeHtml` are removed from `telegram.ts`
- [ ] `telegram.ts` imports `toHtmlSummary`, `toHtmlDetail`, `toHtmlActiveOverview` from `./format`
- [ ] Each call site is a one-liner replacement
- [ ] Bot behavior is unchanged — messages display the same content (with minor normalization)
- [ ] All existing tests pass: `bun test`
- [ ] `bun x tsc --noEmit` passes

## 4. Functional Requirements

- **FR-1:** `resolveDisplayData` must be a pure function that accepts `AnalyzedItem` and returns `ItemDisplayData` with no side effects or I/O
- **FR-2:** `format.ts` must have only a type-only import of `AnalyzedItem` from `db.ts` — no runtime dependencies on database, network, Telegraf, or config
- **FR-3:** The `ItemRenderer<T>` interface must use optional methods (`summary?`, `detail?`, `tableRow?`, `table?`, `activeOverview?`) so renderers only implement what they need
- **FR-4:** `plainText` must implement all 5 renderer methods (summary, detail, tableRow, table, activeOverview)
- **FR-5:** `telegramHtml` must implement summary, detail, and activeOverview methods
- **FR-6:** All HTML renderers must escape user-generated text (product names, manual review reasons, AI reasoning) using an internal `escapeHtml` helper — callers must never need to escape manually
- **FR-7:** Where CLI and Telegram output previously differed in wording or section ordering, the normalized output must follow Telegram's conventions as the reference
- **FR-8:** The `printAnalysisSummary` function must be moved from `analyze.ts` to `cli.ts`, with `analyze.ts` no longer exporting it
- **FR-9:** After migration, no formatting business logic (max bid classification, deal scoring, eBay/AI gating) may remain in `cli.ts`, `analyze.ts`, or `telegram.ts` — all must be in `format.ts`

## 5. Non-Goals (Out of Scope)

- **No new renderers.** The `ItemRenderer` interface enables future Ntfy/Markdown/TUI renderers, but this PRD does not spec or implement any beyond `plainText` and `telegramHtml`.
- **No retroactive Telegram tests.** Existing Telegram formatting code is deleted, not backfill-tested. The new `format.test.ts` covers the replacement.
- **No changes to `AnalyzedItem` or the database schema.** The view model adapts to the existing 43-field interface.
- **No changes to Telegram bot behavior.** Inline keyboards, callbacks, authentication, and command handling remain in `telegram.ts`.
- **No changes to analysis logic.** `analyzeItem()`, pricing calculations, and estimate blending in `analyze.ts` are untouched.
- **No CLI output coloring or rich terminal formatting.** Plain text only, as today.

## 6. Edge Cases & Error Handling

- **`llm_comparables` is invalid JSON:** `resolveDisplayData` must return `ai.comparables: []` (not throw). Currently handled with try/catch in 3 places — consolidated to one.
- **`llm_comparables` is valid JSON but not an array:** Return `[]`.
- **`manual_review_reason` is null but `needs_manual_review` is true:** Display reason as `"Unknown reason"`.
- **`deal_score` is null:** Display as `"N/A"` in all renderers. Sort to end in activeOverview.
- **`recommended_max_bid` is exactly 0:** Classified as `not_worth_it` (uses `<= 0` check, not `< 0`).
- **`recommended_max_bid` is negative:** Classified as `not_worth_it`, displays the negative value.
- **Product name contains HTML-sensitive characters (`&`, `<`, `>`):** HTML renderers must escape. Plain text renderers pass through unchanged.
- **Product name exceeds 38 characters in table row:** Truncate to 37 characters + "…" in `plainText.tableRow`.
- **Empty item list passed to `table()` or `activeOverview()`:** Return a "No results" / "No active items" message, not an empty string.
- **`auction_location` is null:** Display as `"Unknown"`.
- **`sales_tax_rate` is null in detail view:** Omit the sales tax line from the cost breakdown.

## 7. Technical Considerations

- **File location:** `src/format.ts` (module), `src/format.test.ts` (tests)
- **Dependency direction:** `format.ts` imports only `type { AnalyzedItem }` from `./db`. No circular dependencies. `cli.ts`, `analyze.ts`, and `telegram.ts` import from `./format`.
- **Test approach:** All tests use plain object literals for `AnalyzedItem` input — no database, no mocks, no network. A `makeItem(overrides)` factory function (similar to existing test helpers) keeps test data concise.
- **Migration safety:** Each caller migration (US-006, US-007) can be verified independently. Run `bun test` after each step.
- **Existing test updates:** Some assertions in `cli.test.ts` and `analyze.test.ts` reference formatting output from functions that will be removed. These assertions should be updated to test the new call paths or removed if covered by `format.test.ts`.
- **RFC reference:** Full architectural design is in `.william/rfcs/unify-display-formatting.md`.

## 8. Success Metrics

- Zero display business logic rules remain in `cli.ts`, `analyze.ts`, or `telegram.ts` after migration
- `format.test.ts` covers all 8 business logic rules and both renderers — target 100% branch coverage of `resolveDisplayData`
- All existing tests continue to pass (`bun test`)
- TypeScript compiles cleanly (`bun x tsc --noEmit`)
- Net reduction in total lines of display code across the codebase (target: ~100+ lines removed)

## 9. Open Questions

- None — all questions resolved during RFC and PRD review.
