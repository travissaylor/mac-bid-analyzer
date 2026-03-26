# PRD: Image Red Flag Analysis

## 1. Introduction/Overview

Mac.bid listings often include actual product photos alongside the stock image, but the current analysis pipeline ignores them entirely. This feature adds multimodal LLM image analysis to detect physical damage, missing parts, and product mismatches before the price estimation step — catching lemons before you bid.

## 2. Goals

- Detect physical damage (cracks, dents, scratches, water damage) visible in product photos
- Identify missing parts or accessories that should be present
- Flag cases where actual product photos don't match the stock image / product name
- Surface findings with tiered severity that adjusts the confidence score and max bid recommendation
- Skip analysis when only a stock image is available (no actual product photos to inspect)

## 3. User Stories

### US-001: Extract multiple image URLs from listing data

**Description:** As the system, I need to extract all image URLs from mac.bid SSR data so that I have access to both the stock image and actual product photos.

**Acceptance Criteria:**

- [ ] SSR data is parsed to extract all available image URLs (not just the first/stock image)
- [ ] Images are classified as "stock" (first image) vs. "actual" (subsequent images)
- [ ] The `MacBidLotItem` type is extended to hold an array of image URLs alongside the existing `image_url` field
- [ ] If only one image exists (the stock image), it is flagged as stock-only
- [ ] Typecheck passes

### US-002: Build image analysis LLM prompt

**Description:** As the system, I need a multimodal prompt that instructs the LLM to inspect product photos for red flags so that findings are structured and actionable.

**Acceptance Criteria:**

- [ ] Prompt includes the product name, listed condition, and category as context
- [ ] Prompt instructs the LLM to look for: physical damage, missing parts/accessories, and mismatch between the product and what's shown
- [ ] When both stock and actual images are provided, prompt instructs comparison for mismatch detection
- [ ] LLM returns structured JSON with an array of findings, each containing: `type` (damage | missing_parts | mismatch), `severity` (high | medium | low), `description` (string), and `imageIndex` (which image)
- [ ] LLM also returns an `overallRisk` score (0-100) and `stockImageOnly` (boolean, true if the LLM determines the photos are all stock/generic)
- [ ] Typecheck passes

### US-003: Call LLM with images for analysis

**Description:** As the system, I need to send product images to the configured LLM provider (Gemini or OpenAI) as a multimodal request so that images are actually analyzed.

**Acceptance Criteria:**

- [ ] Images are fetched by URL and sent to the LLM as part of a multimodal content request
- [ ] All non-stock images are included (no cap on image count)
- [ ] The stock image is included when mismatch detection is relevant (product has actual photos to compare against)
- [ ] Uses the same LLM provider/model configured in `llm_model` config
- [ ] Both `GeminiProvider` and `OpenAIProvider` support the new image analysis method
- [ ] Response is parsed and validated against the expected JSON schema
- [ ] Typecheck passes

### US-004: Integrate image analysis into the analysis pipeline

**Description:** As a user, I want image analysis to run before the price estimate so that red flag findings can influence the confidence score and max bid recommendation.

**Acceptance Criteria:**

- [ ] Image analysis runs after lot data is fetched but before the price estimation LLM call
- [ ] If no actual product photos exist (stock-only), image analysis is skipped entirely
- [ ] If the LLM detects only stock/generic images despite multiple URLs, analysis is skipped (treated as stock-only)
- [ ] Image findings are passed to the price estimation step as additional context
- [ ] High severity findings reduce `llm_confidence` by a significant amount (e.g., -20 per high finding)
- [ ] Medium severity findings reduce `llm_confidence` moderately (e.g., -10 per medium finding)
- [ ] Low severity findings reduce `llm_confidence` slightly (e.g., -5 per low finding)
- [ ] Confidence floor is 0 (never goes negative)
- [ ] When any red flags are found, the item is flagged for manual review with a reason summarizing the findings
- [ ] Typecheck passes

### US-005: Store image analysis results in the database

**Description:** As the system, I need to persist image analysis findings so they can be displayed later and tracked over time.

**Acceptance Criteria:**

- [ ] New columns added to `analyzed_items`: `image_flags` (TEXT, JSON string of findings array), `image_risk_score` (REAL, 0-100), `image_analysis_skipped` (INTEGER, 1 if skipped due to stock-only)
- [ ] Schema migration adds columns to existing databases without data loss
- [ ] `AnalyzedItem` interface is updated with the new fields
- [ ] Upsert statement includes the new columns
- [ ] Typecheck passes

### US-006: Display image red flags in Telegram notifications

**Description:** As a user, I want to see a summary of image red flags in Telegram notifications so I can quickly assess risk without opening the listing.

**Acceptance Criteria:**

- [ ] Summary view shows a one-line warning when red flags exist, e.g., "Image flags: possible crack on screen, missing power cable"
- [ ] Detail view shows a full breakdown with severity per finding
- [ ] If image analysis was skipped (stock-only), summary shows "No product photos available"
- [ ] Plain text renderer is also updated for CLI output consistency
- [ ] Typecheck passes

### US-007: Display image red flags in CLI output

**Description:** As a user, I want to see image red flag information in CLI detail output so I have full context when analyzing from the terminal.

**Acceptance Criteria:**

- [ ] Detail view includes an "Image Analysis" section with all findings, severity, and risk score
- [ ] Summary view includes a brief red flag indicator when flags exist
- [ ] Typecheck passes

## 4. Functional Requirements

- **FR-1:** The system must extract all image URLs from mac.bid SSR data. The first image is classified as "stock" and all subsequent images as "actual product photos."
- **FR-2:** The system must skip image analysis entirely when no actual product photos are available (only stock image exists).
- **FR-3:** The system must send all actual product photos (plus the stock image for mismatch comparison) to the configured LLM as a multimodal request.
- **FR-4:** The LLM must return structured findings as JSON: an array of `{type, severity, description, imageIndex}` plus an `overallRisk` score (0-100).
- **FR-5:** Finding types must be one of: `damage`, `missing_parts`, `mismatch`.
- **FR-6:** Severity levels must be one of: `high`, `medium`, `low`. Each level has a defined confidence penalty: high = -20, medium = -10, low = -5.
- **FR-7:** The system must apply cumulative confidence penalties from image findings to the `llm_confidence` score, with a floor of 0.
- **FR-8:** The system must flag any item with image red flags for manual review, with the review reason summarizing the top findings.
- **FR-9:** Image analysis must run before the price estimation LLM call so findings can be included as context in the pricing prompt.
- **FR-10:** Image analysis results must be stored in the database (`image_flags`, `image_risk_score`, `image_analysis_skipped` columns).
- **FR-11:** Telegram summary notifications must include a one-line image flag summary when red flags are present.
- **FR-12:** Telegram detail view and CLI detail view must show the full breakdown of image findings with severity.
- **FR-13:** If the LLM determines that all provided images are stock/generic (despite multiple URLs), image analysis results are discarded and treated as stock-only/skipped.

## 5. Non-Goals (Out of Scope)

- **No image caching or local storage:** Images are fetched on-demand from mac.bid URLs during analysis. No local image storage or CDN caching.
- **No separate image analysis model config:** Uses the same `llm_model` provider configured for price estimation. No new config field.
- **No image quality enhancement:** If photos are blurry or low-resolution, the LLM works with what it gets. No upscaling or preprocessing.
- **No historical image comparison:** No tracking of how images change over time for the same lot.
- **No automated bidding adjustment:** Image flags adjust confidence and flag for review, but do not automatically skip or reject items.
- **No OCR or text extraction from images:** Not reading serial numbers, labels, or text in photos.

## 6. Edge Cases & Error Handling

- **Image fetch failure:** If one or more image URLs fail to download (404, timeout, etc.), analyze the images that were successfully fetched. If all image fetches fail, skip image analysis and log a warning. Do not fail the overall analysis.
- **LLM image analysis failure:** If the multimodal LLM call fails (rate limit, model error, etc.), skip image analysis gracefully. Log a warning and proceed with price estimation without image context. Do not flag for manual review due to analysis failure.
- **LLM returns malformed response:** If the image analysis JSON is unparseable or missing required fields, skip image analysis and log a warning. Use the same `extractJson` + validation pattern from the existing `parseEstimateResponse`.
- **No actual product photos:** When only the stock image exists, skip analysis entirely. Store `image_analysis_skipped = 1`. This is the normal path for many listings.
- **All images are generic/stock:** LLM may determine that despite multiple URLs, all images are stock photos. Treat this the same as "no actual photos" — skip and set `image_analysis_skipped = 1`.
- **Very many images (>10):** Some listings may have many photos. Send all of them — the user chose thoroughness over cost. If token limits are hit, the LLM provider will error and the graceful failure path applies.
- **Condition is already "As-Is" or "Salvage":** Image damage findings are still relevant — the user wants to know the *specific* damage, even if the condition label already implies issues.

## 7. Technical Considerations

- **Multimodal API differences:** Gemini and OpenAI have different multimodal content formats. Gemini uses `inlineData` or URL parts; OpenAI uses `image_url` content parts. The `LLMProvider` interface needs a new method (e.g., `analyzeImages`) or the existing `estimate` method needs to accept image inputs.
- **New LLM provider method:** Add an `analyzeImages(input: ImageAnalysisInput): Promise<ImageAnalysisResult>` method to the `LLMProvider` interface. Both `GeminiProvider` and `OpenAIProvider` implement it.
- **Prompt engineering:** The image analysis prompt should be specific about what constitutes each severity level. For example, a hairline scratch is low; a visibly cracked screen is high; a dent on a cosmetic surface is medium.
- **Confidence penalty tuning:** The -20/-10/-5 penalties are starting values. They may need adjustment based on real-world results. Consider making them configurable in `config.ts` later if needed.
- **Token cost:** Multimodal requests are more expensive. Each analysis adds cost proportional to the number/size of images. This is an accepted tradeoff per user preference.
- **Existing code to extend:**
  - `src/analyze.ts` — main pipeline, add image analysis step before price estimation
  - `src/llm/index.ts` — `LLMProvider` interface, add `analyzeImages` method
  - `src/llm/gemini.ts` / `src/llm/openai.ts` — implement multimodal image calls
  - `src/db.ts` — new columns, migration, updated types
  - `src/format.ts` — updated renderers for both plain text and Telegram HTML
  - New file: `src/llm/image-prompt.ts` — image analysis prompt and response parsing

## 8. Success Metrics

- Image analysis runs successfully on listings that have actual product photos
- Red flags are correctly identified in at least the obvious cases (visible cracks, clearly wrong item)
- False positive rate is low enough that manual review flags from image analysis are useful, not noisy
- Analysis pipeline latency increase is acceptable (image analysis adds one additional LLM call)
- No regressions in existing analysis flow — stock-image-only listings behave exactly as before

## 9. Open Questions

- **What fields does the SSR data use for multiple images?** Need to inspect actual SSR responses to determine the key name (e.g., `images`, `gallery`, `photos`) and URL format for non-stock images. This must be determined during implementation.
- **Confidence penalty values:** The -20/-10/-5 values are initial guesses. Should we make these configurable from the start, or hardcode and tune later?
- **Should image findings affect the price estimation prompt?** Currently scoped as "run before price estimation and pass findings as context." But how much context? Just the risk score, or the full findings list?
- **Image URL format:** Are the actual product photo URLs on the same CDN/domain as the stock image, or do they need different fetch handling (auth headers, etc.)?
