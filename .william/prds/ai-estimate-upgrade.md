<prd>
# PRD: First-Class AI Estimates

## Introduction

Upgrade the AI-powered pricing estimates from a fallback mechanism to a first-class, always-on estimation source. Currently, Gemini runs only when eBay comps are insufficient, with thinking disabled and minimal output. This feature enables thinking mode, removes output token limits, produces rich analysis (reasoning, confidence, comparable products), and blends AI estimates with eBay data using a weighted system based on AI confidence and eBay comp count. The goal is for AI estimates to be potentially more reliable than eBay comps alone.

## Goals

- Run AI estimates for every analyzed item, not just as a fallback
- Enable Gemini thinking mode for deeper reasoning and more accurate pricing
- Produce rich output: low/mid/high prices, confidence score, reasoning, and comparable products
- Store full AI analysis in the database for later review
- Implement a weighted blending system that combines AI and eBay estimates when both are available
- Make the AI model configurable (e.g., Gemini 2.5 Flash vs Pro) via config
- Remove the artificial 256 max output token limit

## User Stories

### US-001: Enable Thinking and Remove Token Limit

**Description:** As a developer, I want to enable Gemini's thinking mode and remove the max output token limit so the model can reason deeply about pricing.

**Acceptance Criteria:**

- [ ] `thinkingConfig.thinkingBudget` is removed or set to a positive value (not 0)
- [ ] `maxOutputTokens: 256` is removed from the Gemini config
- [ ] Temperature remains low (0.1) to keep estimates consistent
- [ ] Existing items can still be analyzed without errors
- [ ] Typecheck/lint passes

### US-002: Expand AI Prompt for Full Analysis

**Description:** As a user, I want the AI to explain its reasoning, state its confidence, and list comparable products so I can judge the estimate quality.

**Acceptance Criteria:**

- [ ] Prompt requests a confidence score (0-100) indicating estimate reliability
- [ ] Prompt requests a reasoning explanation (how it arrived at the price)
- [ ] Prompt requests a list of comparable products/listings it's basing the estimate on
- [ ] Response is structured JSON with fields: `low`, `mid`, `high`, `confidence`, `reasoning`, `comparables`
- [ ] `comparables` is an array of objects with at least `name` and `estimatedPrice` fields
- [ ] Response parsing handles the new expanded JSON format
- [ ] Graceful fallback if model returns partial fields (e.g., missing `comparables` but valid prices)
- [ ] Typecheck/lint passes

### US-003: Update GeminiEstimate Interface and Types

**Description:** As a developer, I need the TypeScript interfaces to reflect the new rich estimate format.

**Acceptance Criteria:**

- [ ] `GeminiEstimate` interface includes: `low`, `mid`, `high`, `confidence` (number 0-100), `reasoning` (string), `comparables` (array)
- [ ] A new `GeminiComparable` interface exists with at least `name: string` and `estimatedPrice: number`
- [ ] All consumers of `GeminiEstimate` are updated to handle the new fields
- [ ] Typecheck/lint passes

### US-004: Make AI Model Configurable

**Description:** As a user, I want to choose which Gemini model to use (e.g., Flash vs Pro) via config so I can balance cost, speed, and accuracy.

**Acceptance Criteria:**

- [ ] `config.json` (or equivalent config source) has a new field like `gemini_model` (e.g., `"gemini-2.5-flash"`, `"gemini-2.5-pro"`)
- [ ] `getGeminiEstimate` reads the model from config instead of hardcoding it
- [ ] Default value is `"gemini-2.5-flash"` if not specified in config
- [ ] Changing the config value changes which model is called
- [ ] Typecheck/lint passes

### US-005: Add AI Analysis Columns to Database

**Description:** As a developer, I need to store the full AI analysis in the database so it can be reviewed later.

**Acceptance Criteria:**

- [ ] New columns added to `analyzed_items`: `llm_confidence` (REAL), `llm_reasoning` (TEXT), `llm_comparables` (TEXT, JSON string)
- [ ] Schema migration or table creation updated with new columns
- [ ] `upsertAnalyzedItem` writes the new fields when available
- [ ] Null/missing values handled gracefully (columns are nullable)
- [ ] Typecheck/lint passes

### US-006: Always Run AI Estimate

**Description:** As a user, I want AI estimates to run for every item so I always have an AI-powered price opinion, not just when eBay data is scarce.

**Acceptance Criteria:**

- [ ] `analyzeItem` always calls `getGeminiEstimate`, regardless of eBay comp count
- [ ] AI estimate runs in parallel with (or after) eBay lookup, not blocked by eBay results
- [ ] AI and eBay remain independent — eBay comp data is NOT passed into the AI prompt
- [ ] Both eBay and AI results are stored in the database for every item (when available)
- [ ] Items are no longer flagged as "advisory only" just because they used AI estimates
- [ ] Circuit breaker still applies to Gemini API failures
- [ ] Typecheck/lint passes

### US-007: Implement Weighted Blend for Max Bid

**Description:** As a user, I want the max bid to be calculated from a weighted blend of AI and eBay estimates so I get the most informed recommendation possible.

**Acceptance Criteria:**

- [ ] When both AI and eBay estimates are available, max bid is based on a weighted blend of the two
- [ ] Blend weights factor in BOTH AI confidence score AND eBay comp count
- [ ] Higher AI confidence increases AI's weight in the blend
- [ ] More eBay comps increases eBay's weight in the blend
- [ ] When only AI is available (no eBay comps), AI estimate is used directly
- [ ] When only eBay is available (AI failed), eBay estimate is used directly (current behavior)
- [ ] The blended estimate used for max bid is stored or derivable from stored data
- [ ] `analysis_source` field updated to reflect the new blending (e.g., `"blended"`, `"ai"`, `"ebay"`)
- [ ] Typecheck/lint passes

### US-008: Display AI Analysis in CLI Output

**Description:** As a user, I want to see the AI's confidence, reasoning, and comparable products in the analysis summary so I can evaluate the estimate.

**Acceptance Criteria:**

- [ ] `printAnalysisSummary` shows AI confidence score (e.g., `"AI Confidence: 82/100"`)
- [ ] AI reasoning text is displayed in the summary output
- [ ] Comparable products listed with names and estimated prices
- [ ] When blended estimate is used, summary shows both source estimates and the blend result
- [ ] Output is readable and not overwhelming (reasoning can be truncated if very long)
- [ ] Typecheck/lint passes

### US-009: Query AI Analysis from Database

**Description:** As a user, I want to be able to view the stored AI analysis for previously analyzed items.

**Acceptance Criteria:**

- [ ] A CLI command or flag (e.g., `detail <lot-id>`) shows the full AI analysis for a specific item
- [ ] Output includes: AI low/mid/high, confidence, reasoning, and comparable products
- [ ] Also shows eBay data alongside for comparison
- [ ] Shows which source(s) contributed to the final max bid
- [ ] Handles items that were analyzed before this feature (missing AI analysis fields) gracefully
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: Remove `thinkingConfig: { thinkingBudget: 0 }` and enable thinking mode in Gemini calls
- FR-2: Remove `maxOutputTokens: 256` from Gemini config
- FR-3: Update the Gemini prompt to request structured JSON with fields: `low`, `mid`, `high`, `confidence`, `reasoning`, `comparables`
- FR-4: Parse and validate the expanded Gemini response, with graceful handling of partial responses
- FR-5: Add `gemini_model` to the config system with a default of `"gemini-2.5-flash"`
- FR-6: Pass the configured model name to the Gemini API call instead of hardcoding
- FR-7: Add `llm_confidence` (REAL), `llm_reasoning` (TEXT), and `llm_comparables` (TEXT) columns to `analyzed_items`
- FR-8: Update `upsertAnalyzedItem` to persist all new AI analysis fields
- FR-9: Call `getGeminiEstimate` for every item in `analyzeItem`, not just as a fallback
- FR-10: Run AI and eBay estimation independently (do not pass eBay data into AI prompt)
- FR-11: Implement a `blendEstimates` function that computes a weighted average of AI mid and eBay median
- FR-12: Blend weights are determined by a formula considering AI confidence (0-100) and eBay comp count
- FR-13: Use the blended estimate as the basis for `calculateMaxBid` when both sources are available
- FR-14: Update `analysis_source` to support `"blended"` in addition to existing values
- FR-15: Display AI confidence, reasoning, and comparables in `printAnalysisSummary`
- FR-16: Add a detail view command for viewing full AI analysis of a specific item
- FR-17: Remove the `needs_manual_review` flag that was set solely because AI was used as a fallback (other manual review triggers like condition-based remain)

## Non-Goals

- No feeding eBay comp data into the AI prompt — the two sources remain independent signals
- No switching away from Google Gemini to a different AI provider (e.g., OpenAI, Anthropic)
- No UI/web interface — this remains a CLI tool
- No automatic model selection based on item category or value
- No historical tracking of estimate accuracy over time (may be a future feature)
- No changes to the eBay search/estimation logic itself
- No changes to the circuit breaker, notification, or error handling systems beyond supporting the new flow

## Technical Considerations

- **Gemini Thinking Mode:** Enabling thinking will increase latency and token usage. Since this runs per-item, consider the cost implications when processing large batches. The configurable model helps here — users can use Flash for bulk and Pro for high-value items.
- **Response Parsing:** The expanded JSON response is more complex. The regex-based JSON extraction (`text.match(/\{[\s\S]*?\}/)`) may need updating to handle nested objects (comparables array). Consider using a more robust JSON extraction approach.
- **Parallel Execution:** AI and eBay calls should run concurrently (`Promise.all` or similar) to minimize latency since they're independent.
- **Blend Formula:** A reasonable starting formula could be:
  - `aiWeight = aiConfidence / 100`
  - `ebayWeight = min(ebayCompCount / minEbayComps, 1.0)`
  - Normalize: `totalWeight = aiWeight + ebayWeight`, then `blendedEstimate = (aiMid * aiWeight + ebayMedian * ebayWeight) / totalWeight`
- **Database Migration:** Adding columns to an existing SQLite table — use `ALTER TABLE ADD COLUMN` for each new column, or handle via the existing schema creation logic if tables are recreated.
- **Backward Compatibility:** Items analyzed before this change will have NULL values for the new columns. All queries and display logic must handle this gracefully.

## Success Metrics

- AI estimates run for 100% of analyzed items (not just fallback cases)
- AI confidence score correlates with estimate accuracy (when compared to actual sale prices)
- Blended estimates are closer to actual resale values than either source alone
- Full AI reasoning is stored and retrievable for every analyzed item
- No increase in manual review flags caused solely by using AI estimates
- Batch processing latency increase is acceptable (< 2x current per-item time)

## Open Questions

- What specific blend weight formula should be used? The technical considerations section proposes one, but it may need tuning based on real-world results.
- Should there be a minimum AI confidence threshold below which the AI estimate is excluded from the blend?
- Should the detail view be a new subcommand (e.g., `detail 12345`) or a flag on the existing results command (e.g., `results --detail 12345`)?
- How should the CLI handle very long reasoning text — truncate with a "full" flag, or always show everything?
</prd>
