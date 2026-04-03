# PRD: Use AI as Primary Market Value Estimator

## 1. Introduction/Overview

The current analysis pipeline fetches eBay sold comps, feeds them to the LLM as context, then blends the LLM's estimate with the eBay median using a weighted average (`blendEstimates`). This double-counts the eBay signal since the LLM already incorporates eBay data into its estimate. This change makes the AI estimate the sole market value input for max bid calculation, removes the blending logic, and updates the LLM prompt to reinforce its role as the final estimator.

## 2. Goals

- Eliminate double-counting of eBay data in the max bid calculation
- Simplify the analysis pipeline by removing the blending step
- Make the AI estimate the authoritative market value when available
- Update display formatting to reflect the removal of blended source
- Update the LLM prompt to emphasize its responsibility as the final estimator

## 3. User Stories

### US-001: Remove blended estimate from max bid calculation

**Description:** As a user, I want the AI estimate to be used directly for my max bid calculation so that the eBay data isn't double-counted.

**Acceptance Criteria:**

- [ ] When both eBay and AI data are available, `calculateMaxBid` receives `llmEstimateMid` (not a blended value)
- [ ] The `blendEstimates` function is deleted from `analyze.ts`
- [ ] The `blendEstimates` import and tests are removed from `analyze.test.ts`
- [ ] The `analysis_source` is set to `"ai"` when both eBay and AI are available (not `"blended"`)
- [ ] The eBay-only fallback path is preserved for when AI is unavailable
- [ ] Typecheck passes

### US-002: Remove blend display from formatting

**Description:** As a user, I want the display output to show the AI estimate as the base price instead of a "Blended" line so the output reflects how the max bid was actually calculated.

**Acceptance Criteria:**

- [ ] The `blend` field is removed from `ItemDisplayData` in `format.ts`
- [ ] The `resolveDisplayData` function no longer computes blend info
- [ ] The plain text detail renderer shows `Base Estimate (AI): $X.XX` when source is `"ai"` and AI data exists
- [ ] The Telegram HTML detail renderer shows `Base: $X.XX (AI)` when source is `"ai"` and AI data exists
- [ ] The cost breakdown section no longer renders a "Blended" line
- [ ] References to `"ebay-only"` and `"ai-only"` source strings in formatters are updated to match actual source values (`"ebay"` and `"ai"`)
- [ ] Typecheck passes

### US-003: Update LLM prompt to emphasize estimator role

**Description:** As a user, I want the LLM prompt to clearly communicate that its estimate will be used directly for the max bid calculation, so the model takes its role seriously and produces well-calibrated estimates.

**Acceptance Criteria:**

- [ ] The system prompt in `llm/prompt.ts` is updated to tell the LLM its estimate is the primary input for the max bid calculation
- [ ] The prompt still instructs the LLM to weight eBay sold data heavily when available
- [ ] No changes to the response JSON format
- [ ] Existing prompt tests are updated to match
- [ ] Typecheck passes

## 4. Functional Requirements

- **FR-1:** When both eBay comps and AI estimate are available, the system must use `llmEstimateMid` as the input to `calculateMaxBid` (replacing the blended value).
- **FR-2:** The `analysis_source` field must be set to `"ai"` when the AI estimate is used, regardless of whether eBay data was also available.
- **FR-3:** The `blendEstimates` function must be removed entirely from the codebase (function, export, tests).
- **FR-4:** When AI is unavailable (no API key or LLM failure) but sufficient eBay comps exist, the system must fall back to `calculateMaxBid` using `ebayMedian` with `analysis_source` set to `"ebay"`.
- **FR-5:** The `blend` field must be removed from `ItemDisplayData` and all rendering logic that references it.
- **FR-6:** The cost breakdown in both plain text and Telegram HTML detail views must show `Base Estimate (AI)` or `Base: $X.XX (AI)` when the source is `"ai"`.
- **FR-7:** The LLM system prompt must state that the AI's mid estimate is used directly to calculate the recommended max bid.
- **FR-8:** The priority cascade in `analyzeItem` must be: (1) manual review conditions skip recommendation, (2) AI available → use AI mid, (3) eBay-only fallback, (4) no data → manual review.

## 5. Non-Goals (Out of Scope)

- No changes to the eBay search logic or cascade strategy
- No changes to the image analysis pipeline
- No changes to `calculateMaxBid` formula itself (discount threshold, fees, tax, location cost)
- No changes to the confidence penalty logic from image analysis (confidence still adjusts, it just doesn't affect blending weight anymore)
- No changes to the database schema — `analysis_source` already supports arbitrary strings
- No migration of existing `"blended"` records in the database — they remain as historical data

## 6. Edge Cases & Error Handling

- **AI available, eBay has 0 comps:** AI still receives `eBay Comps: No completed sales found` in its prompt. AI mid is used directly. Source = `"ai"`.
- **AI available, eBay has comps below min_ebay_comps:** AI receives the eBay data in its prompt. AI mid is used directly. Source = `"ai"`. (This is a behavior change — previously this path used AI-only without the `hasEbay` flag.)
- **AI unavailable, eBay has sufficient comps:** eBay median used directly. Source = `"ebay"`.
- **AI unavailable, eBay has insufficient comps:** No recommendation. Manual review flagged.
- **Old records with `analysis_source = "blended"` in DB:** Display formatters should handle gracefully — the blend field is removed, so the cost breakdown simply won't show a base estimate line for old records. This is acceptable.
- **AI confidence is very low (e.g., < 30):** AI mid is still used. Confidence is informational only; it no longer affects the estimate weight.

## 7. Technical Considerations

- **Files to modify:**
  - `src/analyze.ts` — Remove `blendEstimates`, update the max bid calculation cascade in `analyzeItem`
  - `src/analyze.test.ts` — Remove `blendEstimates` tests, update integration test expectations
  - `src/format.ts` — Remove `blend` from `ItemDisplayData`, update `resolveDisplayData`, update cost breakdown rendering in both plain text and Telegram renderers
  - `src/format.test.ts` — Update test expectations for source strings and removed blend field
  - `src/llm/prompt.ts` — Update `SYSTEM_PROMPT` to emphasize estimator responsibility
  - `src/llm/prompt.test.ts` — Update prompt snapshot tests if any
- **The `calculateMaxBid` function is unchanged** — it already takes a single market value input. The change is purely about what value we pass in.
- **The image confidence penalty still applies** — it adjusts `llmConfidence` and may flag items for manual review, but it no longer affects blending weights (since blending is removed).

## 8. Success Metrics

- All existing tests pass (with updated expectations) and typecheck is clean
- The `blendEstimates` function and `"blended"` source no longer appear in the codebase
- When both eBay and AI are available, the max bid is derived from AI mid, not a weighted average
- The eBay-only fallback still works when AI is unavailable

## 9. Open Questions

- Should the `analysis_source` distinguish between `"ai"` (with eBay context) and `"ai"` (without eBay context)? Current decision is no — the LLM prompt always includes whatever eBay data is available, so the source is always `"ai"`. This could be revisited if reporting needs arise.
