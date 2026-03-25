# PRD: Improve LLM Estimation Prompt

## 1. Introduction/Overview

The LLM price estimation prompt currently produces inaccurate secondary market value estimates, with even the best model (gemini-3.1-pro-preview) averaging $66.50 MAE and only 42% coverage rate. The primary issues are retail price anchoring, missing eBay market data in the prompt, and no guidance on brand recognition or condition-based depreciation. This PRD covers prompt improvements and the pipeline changes needed to feed richer data to the LLM and validate improvements through the eval framework.

## 2. Goals

- Reduce MAE across all evaluated models by at least 30% (best model target: MAE < $45)
- Increase coverage rate (true value within low-high range) to > 60% for the best model
- Improve confidence correlation so the top models achieve > 0.7 (confidence scores are meaningful)
- Pass eBay sold data to the LLM when available, so real market comps anchor estimates
- Maintain backward compatibility — prompt changes should not require schema migrations or break existing analysis flows

## 3. User Stories

### US-001: Add eBay sold data to LLMInput

**Description:** As a developer, I want eBay sold data (median price and comp count) included in the LLM input so that the model can anchor estimates on real market data when available.

**Acceptance Criteria:**

- [ ] `LLMInput` interface in `src/llm/index.ts` includes `ebaySoldMedian: number | null` and `ebaySoldCount: number | null`
- [ ] `buildUserPrompt()` includes eBay data when `ebaySoldCount > 0` (e.g., `eBay Sold Median: $210.14 (34 recent sales)`)
- [ ] When `ebaySoldCount` is 0 or null, the prompt includes `eBay Comps: No completed sales found` so the model knows data was looked up but unavailable
- [ ] Existing callers of `LLMInput` (`analyzeItem`, eval runner) updated to pass the new fields
- [ ] All existing tests pass; new tests cover both data-present and data-absent prompt paths
- [ ] Typecheck passes

### US-002: Add anti-anchoring and category guidance to system prompt

**Description:** As a user, I want the LLM to stop anchoring heavily to retail price so that estimates for cheap/generic items are more accurate.

**Acceptance Criteria:**

- [ ] System prompt includes explicit warning not to treat retail price as a strong signal for secondary market value
- [ ] System prompt includes qualitative guidance that unknown/generic brands typically have much lower resale value than established brands
- [ ] System prompt includes qualitative guidance that furniture and home goods depreciate heavily on the secondary market compared to electronics
- [ ] System prompt includes qualitative condition guidance (e.g., "Open Box / As-Is items sell for significantly less than new" without prescribing exact percentages)
- [ ] Existing prompt tests updated to reflect new system prompt content
- [ ] Typecheck passes

### US-003: Update eval runner to pass eBay data from fixtures

**Description:** As a developer, I want the eval runner to feed eBay sold data from fixture files to the LLM so that eval results reflect the improved prompt's real-world behavior.

**Acceptance Criteria:**

- [ ] `fixtureToLLMInput()` in `src/eval/runner.ts` maps `ebay_sold_median` and `ebay_sold_count` from fixture items to the new `LLMInput` fields
- [ ] `AnnotatedFixtureItem` type includes `ebay_sold_median` and `ebay_sold_count` if not already present
- [ ] Running `bun run src/cli.ts eval` with the existing fixtures produces results that reflect eBay data being passed to the models
- [ ] Typecheck passes

### US-004: Update analyzeItem to pass eBay data to LLM

**Description:** As a user running production analysis, I want eBay sold data passed to the LLM during `analyzeItem()` so that production estimates benefit from the same data the eval framework uses.

**Acceptance Criteria:**

- [ ] `analyzeItem()` in `src/analyze.ts` passes `ebaySoldMedian` and `ebaySoldCount` from the eBay search result to `provider.estimate()`
- [ ] When eBay search fails or returns no results, `null` / `0` values are passed (triggering the "no comps found" prompt path)
- [ ] Existing analyze tests updated; new test covers eBay data flowing to LLM input
- [ ] Typecheck passes

## 4. Functional Requirements

**Prompt Changes:**

- FR-1: The system prompt must warn the model not to anchor estimates to the retail price. Retail price is provided as context but secondary market values are often 10-50% of retail, especially for generic brands and home goods.
- FR-2: The system prompt must include qualitative guidance on brand recognition — unknown/generic brands (e.g., "Kevinplus", "COZYDESG", "RONGSHU") have significantly lower resale value than established brands (e.g., Apple, Logitech, GIGABYTE).
- FR-3: The system prompt must include qualitative guidance on category-specific depreciation — furniture and home goods depreciate heavily on the secondary market, while well-known electronics brands retain more value.
- FR-4: The system prompt must include qualitative condition guidance — "Open Box" and "As-Is" items sell for less than new, without prescribing specific percentage ranges.
- FR-5: When eBay sold data is available (`ebaySoldCount > 0`), the user prompt must include the median sold price and number of recent sales.
- FR-6: When eBay sold data is unavailable (`ebaySoldCount` is 0 or null), the user prompt must include a line stating no completed sales were found, signaling the model to rely on its own knowledge and estimate more conservatively.

**Pipeline Changes:**

- FR-7: `LLMInput` must be extended with `ebaySoldMedian: number | null` and `ebaySoldCount: number | null`.
- FR-8: `buildUserPrompt()` must conditionally render eBay data based on `ebaySoldCount`.
- FR-9: `fixtureToLLMInput()` in the eval runner must map eBay data from fixture items to `LLMInput`.
- FR-10: `analyzeItem()` must pass eBay search results to `LLMInput` when calling the LLM provider.

## 5. Non-Goals (Out of Scope)

- No changes to the eval metrics or scoring methodology (MAE, MAPE, coverage, confidence correlation calculations stay the same)
- No changes to the `blendEstimates()` logic in `analyzeItem()` — the downstream blending of eBay and AI signals is unchanged
- No changes to fixture data or annotation values
- No addition of new LLM providers or models
- No prompt changes to the JSON output format (low/mid/high/confidence/reasoning/comparables structure stays the same)
- No few-shot examples in the prompt — keep it zero-shot to avoid inflating token cost across all models
- No per-model prompt variants — one prompt serves all providers

## 6. Edge Cases & Error Handling

- **eBay median is 0 but count > 0:** Treat as "no comps found" (the 0 median is a sentinel, not a real price). Check `ebaySoldCount > 0 && ebaySoldMedian > 0` before including data.
- **Very high eBay comp counts with low median:** Include as-is; the model should weigh high comp counts as more reliable data.
- **Retail price is null:** Already handled by `buildUserPrompt()` — omitted from prompt. No change needed.
- **Description contains "As-Is" language but condition field says "LIKE NEW":** Trust the `condition` field as the canonical source; the model may note the discrepancy in reasoning.
- **Model ignores prompt guidance and still anchors to retail:** This is a model capability issue, not a bug. The eval framework will surface which models respond well to the new prompt. No code fix needed.
- **Existing callers of `LLMInput` that don't have eBay data:** Pass `null` for both fields. The prompt should handle this gracefully (same as "no comps found" path).

## 7. Technical Considerations

- **Token cost impact:** The system prompt will grow by ~100-150 tokens. At the cheapest model's pricing (~$0.0002/call), this adds negligible cost. Worth monitoring in eval results.
- **Existing code patterns:** `buildUserPrompt()` already uses a filter-and-join pattern for optional fields. eBay data follows the same pattern.
- **Test files to update:** `src/llm/prompt.test.ts`, `src/eval/runner.test.ts`, `src/analyze.test.ts`. New tests should cover the eBay data conditional rendering.
- **Fixture file format:** `evals/fixtures.jsonl` already contains `ebay_sold_median` and `ebay_sold_count` fields — no fixture changes needed.
- **`AnnotatedFixtureItem` type:** Verify it already includes eBay fields from the fixture JSONL parsing. If not, extend it.

## 8. Success Metrics

- **MAE reduction:** Best model MAE drops from $66.50 to < $45 on the existing 12-item fixture set
- **Coverage rate improvement:** Best model coverage rate improves from 42% to > 60%
- **Confidence correlation:** At least 2 models achieve confidence correlation > 0.7
- **No regressions on well-estimated items:** Items the models already estimate well (Mac Mini, Blue Yeti, SSD) should not get worse
- **Eval cost:** Average cost per estimate does not increase by more than 20% due to longer prompt

## 9. Open Questions

- Should we add a `prompt_version` field to eval reports so we can compare results across prompt iterations? Currently there's no way to tell which prompt produced a given eval run.
- The fixture set is small (12 items) and skews toward electronics and furniture. Should we expand it before drawing conclusions about prompt effectiveness?
- Would it be worth A/B testing the anti-anchoring language (strong vs. subtle) across a larger fixture set to see which framing works best for each model family?
