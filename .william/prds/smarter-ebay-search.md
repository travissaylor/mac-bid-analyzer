# PRD: Smarter eBay Search Query Generation

## Introduction

The eBay search hit rate is low — most items fail to find 5+ comps via the Browse API. The current approach searches using raw UPC (when available) or the unmodified mac.bid product name, both of which frequently miss. This PRD introduces LLM-powered query generation that uses all available item data (name, description, UPC, category) to produce optimized eBay search terms, with a cascading fallback strategy that progressively broadens queries and relaxes filters until enough comps are found.

## Goals

- Increase the percentage of items that reach the ≥5 comp threshold for automated pricing
- Reduce reliance on `analysis_source: "ai"` and `analysis_source: "none"` by getting more eBay data
- Use LLM to generate optimized search queries from messy product names and descriptions
- Implement a cascade strategy: try the best query first, then broaden until comps are found
- Relax condition filters as a final fallback to maximize comp coverage
- Keep UPC search as the primary path when a valid (non-ASIN) UPC is available

## User Stories

### US-001: LLM search query extraction

**Description:** As the system, I want to use an LLM to extract an optimized eBay search query from all available item data so that name-based searches return more relevant results.

**Acceptance Criteria:**

- [ ] A new LLM prompt takes product_name, description, UPC, category, and condition as input
- [ ] The LLM returns a single optimized search query string (brand + model + key identifying specs)
- [ ] The prompt instructs the LLM to strip noise words, marketing fluff, and irrelevant details
- [ ] The prompt instructs the LLM to prioritize brand name, model number, and product type
- [ ] The extraction call uses a lightweight/fast model (e.g., gemini-flash-lite) to minimize latency
- [ ] The extracted query is used in place of raw product_name for eBay API searches
- [ ] Typecheck and lint pass

### US-002: Cascade search strategy

**Description:** As the system, I want to try progressively broader search queries when the initial query returns fewer than `min_ebay_comps` results, so that more items get usable comp data.

**Acceptance Criteria:**

- [ ] When UPC is available (and not an ASIN), UPC/GTIN search is tried first (existing behavior)
- [ ] If UPC search returns < `min_ebay_comps`, fall through to the LLM-generated query
- [ ] If the LLM-generated query returns < `min_ebay_comps`, generate a broader fallback query programmatically (e.g., drop specific specs, keep brand + product type)
- [ ] The cascade stops as soon as any step meets the `min_ebay_comps` threshold
- [ ] The `ebay_search_query` field in the DB records which query ultimately produced the results
- [ ] Each cascade step is logged for debugging/observability
- [ ] Typecheck and lint pass

### US-003: Relax condition filters on retry

**Description:** As the system, I want to relax eBay condition filters when strict filters return too few results, so that we can still find approximate comps rather than nothing.

**Acceptance Criteria:**

- [ ] After all query variations are exhausted with strict condition filters, retry the best query without condition filters
- [ ] When results come from relaxed filters, this is recorded in the analysis metadata (e.g., a flag or note in `ebay_search_query`)
- [ ] The LLM estimate prompt is informed when comps came from mixed conditions so it can adjust confidence
- [ ] Typecheck and lint pass

### US-004: Pass search context to LLM estimate

**Description:** As the system, I want the LLM price estimate to know how the eBay comps were found (query used, filter relaxation) so it can weight them appropriately.

**Acceptance Criteria:**

- [ ] The LLM estimate prompt includes the search query that produced results
- [ ] The prompt indicates whether condition filters were relaxed
- [ ] The prompt indicates whether results came from UPC, LLM-refined query, or broader fallback
- [ ] Typecheck and lint pass

### US-005: Update eval fixtures and metrics

**Description:** As a developer, I want to measure the impact of smarter search on hit rate and pricing accuracy so I can validate the changes.

**Acceptance Criteria:**

- [ ] Add a metric tracking eBay search hit rate (% of items with ≥ `min_ebay_comps`)
- [ ] Add a metric tracking which cascade step produced results (UPC / LLM query / broad query / relaxed filters)
- [ ] Before/after comparison can be run using the existing eval harness
- [ ] Typecheck and lint pass

## Functional Requirements

- FR-1: Add a new function `generateSearchQuery(productName, description, upc, category, condition)` that calls the LLM and returns an optimized eBay search string
- FR-2: The search query extraction prompt must instruct the LLM to return ONLY a search query string (no JSON, no explanation) — brand, model number, and product type, stripped of marketing language
- FR-3: The LLM extraction call must use the configured `llm_model` provider (Gemini or OpenAI) via the existing `createProvider` factory
- FR-4: `searchEbay()` must be refactored to accept a cascade of query strategies rather than a single query
- FR-5: The cascade order must be: (1) UPC/GTIN if available, (2) LLM-generated query with strict condition filter, (3) LLM-generated query without condition filter
- FR-6: A programmatic broadening step (drop trailing specifics from the LLM query) may be added between steps 2 and 3 if warranted during implementation
- FR-7: The cascade must stop at the first step that returns ≥ `min_ebay_comps` results
- FR-8: The `EbayPriceResult` type must be extended with metadata about which cascade step and filters produced the results
- FR-9: The `ebay_search_query` column must record the actual query that produced the final results, prefixed with the strategy (e.g., `upc:123`, `llm:Brand Model`, `llm-broad:Brand`, `llm-relaxed:Brand Model`)
- FR-10: The LLM price estimate prompt must include search provenance metadata so the model can adjust confidence based on comp quality
- FR-11: If the LLM extraction call fails (timeout, error, rate limit), fall back to the existing raw product name search — do not block analysis

## Non-Goals

- No alternative data sources beyond eBay (Amazon, Google Shopping, etc.) — out of scope for this PRD
- No eBay scraping — we stay within the official Browse API
- No caching of LLM-extracted queries in the DB (can be added later if extraction cost becomes an issue)
- No changes to the blending logic between eBay and LLM estimates (existing weighting stays as-is)
- No changes to the `min_ebay_comps` threshold value itself
- No UI/Telegram changes — this is backend search optimization only

## Edge Cases & Error Handling

- **LLM extraction fails:** Fall back to raw product_name search (existing behavior). Log the failure.
- **LLM returns empty or nonsensical query:** Detect empty/very short responses (<3 chars) and fall back to product_name.
- **All cascade steps return 0 results:** Behave exactly as today — `analysis_source` becomes `"ai"` or `"none"` depending on LLM availability.
- **UPC is an ASIN:** Skip UPC/GTIN step entirely (existing behavior), go straight to LLM-generated query.
- **Product has no description:** Pass only product_name and whatever other fields are available to the extraction LLM. The prompt should handle sparse input gracefully.
- **eBay API rate limiting during cascade:** If a cascade step gets rate-limited, stop the cascade and use whatever results were gathered so far.
- **Relaxed-filter results are wildly different from strict results:** The LLM estimate prompt is informed about the relaxation so it can adjust. No automated filtering of outliers in this phase.

## Technical Considerations

- The LLM extraction call should use `gemini-flash-lite` or equivalent fast model to minimize added latency — this is a simple extraction task, not a reasoning task
- The extraction prompt should be short and directive to keep token usage low
- Consider running the LLM extraction in parallel with the UPC search (if UPC is available) to reduce total wall time — if UPC succeeds, discard the extraction result
- The `searchEbay()` function signature will change; update all callers (`analyzeItem`, tests, eval runner)
- The `EbayPriceResult` type gains new metadata fields — update the DB schema and any serialization
- All new behavior should be covered by unit tests, including cascade logic, fallback handling, and prompt construction

## Success Metrics

- eBay search hit rate (≥5 comps) increases from current baseline to >50% of analyzed items
- Reduction in `analysis_source: "none"` items (items with no pricing signal at all)
- Reduction in `analysis_source: "ai"` items where eBay data could have been found
- Average cascade depth is ≤2 (most items resolved by UPC or first LLM query, not requiring broad/relaxed fallback)
- Per-item analysis time stays under 10 seconds for 90th percentile

## Open Questions

- Should we measure and store the cascade depth per item for analytics? (Leaning yes — useful for tuning.)
- Is there a meaningful difference between `gemini-flash-lite` and the configured `llm_model` for extraction quality? May need to test both.
- Should the broad fallback query be generated by the LLM (ask for a second, broader query in the same call) or programmatically (trim the LLM query)?
- Would it be worth adding a `search_strategy` column to the DB schema to track cascade outcomes separately from `ebay_search_query`?
