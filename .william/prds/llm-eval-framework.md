# PRD: LLM Eval Framework

## 1. Introduction/Overview

The mac-bid-analyzer uses LLM estimates to help determine resale values of auction items. Currently there is no systematic way to measure which model provides the best accuracy-to-cost tradeoff. This feature adds an eval framework that runs multiple models against a curated fixture dataset with manually labeled true values, then reports accuracy, cost, and confidence calibration metrics.

## 2. Goals

- Enable data-driven model selection by comparing accuracy across Gemini and OpenAI model tiers
- Quantify the cost-per-estimate for each model so accuracy gains can be weighed against spend
- Validate whether model self-reported confidence scores actually correlate with estimate accuracy
- Provide a repeatable, reproducible eval process using a static fixture dataset

## 3. User Stories

### US-001: Export items to fixture file

**Description:** As a user, I want to export analyzed items from my SQLite database into a JSONL fixture file so that I can annotate them with true resale values for evaluation.

**Acceptance Criteria:**

- [ ] A new CLI command `bun run src/cli.ts eval export --output <path>` exports items from the DB
- [ ] Each line in the output JSONL file contains: `lot_id`, `product_name`, `upc`, `condition`, `retail_price`, `category`, `description`, `ebay_sold_median`, `ebay_sold_count`, and a `true_value` field initialized to `null`
- [ ] The command prints how many items were exported
- [ ] If `--output` is omitted, defaults to `evals/fixtures.jsonl`
- [ ] Skips items that have no `product_name` (invalid data)
- [ ] Typecheck passes

### US-002: Manually annotate fixture file

**Description:** As a user, I want to manually edit the fixture JSONL file to set `true_value` for each item so that the eval runner has ground truth to compare against.

**Acceptance Criteria:**

- [ ] The JSONL format is human-editable (one JSON object per line)
- [ ] The eval runner skips any fixture items where `true_value` is `null` (unannotated)
- [ ] The eval runner prints a warning if fewer than 5 items have non-null `true_value`

### US-003: Run eval across multiple models

**Description:** As a user, I want to run all configured models against my fixture dataset so that I can compare their performance.

**Acceptance Criteria:**

- [ ] A new CLI command `bun run src/cli.ts eval run --fixtures <path> --models <model1,model2,...>` runs the evaluation
- [ ] Models are specified in `provider/model-name` format (e.g., `gemini/gemini-2.5-flash,openai/gpt-4o-mini`)
- [ ] Each model is run against all annotated fixture items
- [ ] Models run in parallel (one model at a time per-item, but all models run concurrently)
- [ ] Results are saved to a JSON report file (default: `evals/results/<timestamp>.json`)
- [ ] Progress is printed to stderr (e.g., `[gemini-2.5-flash] 5/15 items...`)
- [ ] If a model call fails for a specific item, the error is recorded and eval continues
- [ ] Typecheck passes

### US-004: View eval report

**Description:** As a user, I want the eval report to contain per-model summary stats and per-item details so that I can make an informed model choice.

**Acceptance Criteria:**

- [ ] The JSON report file contains a `summary` array with one entry per model, each containing: `model`, `mae`, `mape`, `coverage_rate`, `avg_cost_usd`, `confidence_correlation`, `items_evaluated`, `items_errored`
- [ ] The JSON report file contains a `details` array with per-item results: `lot_id`, `product_name`, `true_value`, and per-model estimates (`low`, `mid`, `high`, `confidence`, `cost_usd`, `latency_ms`, `error`)
- [ ] A `metadata` object includes: `run_at` timestamp, `fixture_path`, `models` list, `total_items`
- [ ] The CLI prints a summary table to stdout after saving the report

### US-005: Track cost per estimate

**Description:** As a user, I want each model call to report its token usage and estimated cost so that I can compare cost efficiency.

**Acceptance Criteria:**

- [ ] The `LLMProvider.estimate()` return type is extended with optional `usage` field: `{ inputTokens: number, outputTokens: number }`
- [ ] The Gemini and OpenAI providers extract token counts from their respective API responses
- [ ] The eval runner calculates cost per call using a pricing config (a simple lookup table of `model -> { inputPer1M, outputPer1M }`)
- [ ] The pricing table is a separate config file (`evals/pricing.json`) that the user can update as prices change
- [ ] If token usage is unavailable from the API, `cost_usd` is recorded as `null`

## 4. Functional Requirements

- **FR-1:** The system must provide an `eval export` subcommand that reads all items from the `analyzed_items` SQLite table and writes them as JSONL to the specified output path.
- **FR-2:** The system must provide an `eval run` subcommand that reads a JSONL fixture file, filters to items with non-null `true_value`, and runs each specified model against every item.
- **FR-3:** The eval runner must call models in parallel (all models concurrently, each processing items sequentially) to minimize total wall-clock time.
- **FR-4:** The system must calculate Mean Absolute Error (MAE) as `avg(|mid_estimate - true_value|)` across all items for each model.
- **FR-5:** The system must calculate Mean Absolute Percentage Error (MAPE) as `avg(|mid_estimate - true_value| / true_value)` across all items for each model.
- **FR-6:** The system must calculate coverage rate as the percentage of items where `true_value` falls within the model's `[low, high]` range.
- **FR-7:** The system must calculate confidence correlation as the Pearson correlation coefficient between the model's confidence scores and `1 - (|mid_estimate - true_value| / true_value)` (i.e., accuracy).
- **FR-8:** The system must record latency (wall-clock ms) for each model call.
- **FR-9:** The system must use the existing `LLMProvider` interface and `createProvider()` factory, reusing the same prompt and parsing logic used in production.
- **FR-10:** The eval report JSON file must be self-contained — a reader should not need the fixture file to understand the results.
- **FR-11:** The system must create the output directory (`evals/results/`) if it does not exist.
- **FR-12:** The system must validate that all specified models use supported providers (`gemini` or `openai`) before starting the eval run.

## 5. Non-Goals (Out of Scope)

- No web UI or dashboard for viewing results — JSON reports and CLI output only
- No automated fixture generation — the user manually sets `true_value` for each item
- No prompt variation testing — all models use the same `buildPrompt()` from `src/llm/prompt.ts`
- No adding new LLM providers (Anthropic, etc.) as part of this feature — use existing Gemini and OpenAI providers
- No integration with the Telegram bot — eval is a CLI-only workflow
- No statistical significance testing (e.g., bootstrap confidence intervals) — simple aggregate metrics are sufficient
- No persistent eval history or trend tracking across runs — each run produces an independent report file

## 6. Edge Cases & Error Handling

- **Empty fixture file:** Print an error and exit with code 1.
- **All `true_value` fields are null:** Print "No annotated items found — annotate true_value in the fixture file first" and exit with code 1.
- **Model API rate limit:** Record the error for that item, continue with remaining items. The summary should note errored items.
- **Invalid model string:** Reject before starting (e.g., `foobar` without a `/` separator). Print which model strings are invalid.
- **Missing API key:** Skip that model entirely with a warning (e.g., "Skipping openai/gpt-4o — no OPENAI_API_KEY set"), do not fail the entire run.
- **Fixture item with `true_value: 0`:** Include it in the eval but exclude from MAPE calculation (division by zero). Note this in the report.
- **Model returns unparseable response:** Record as an error for that item, do not crash the eval.
- **Pricing config missing a model:** Record `cost_usd: null` for that model's calls, print a warning.

## 7. Technical Considerations

- **Existing abstractions:** The `LLMProvider` interface, `createProvider()`, `buildPrompt()`, and `parseEstimateResponse()` in `src/llm/` should be reused directly. The eval runner feeds the same `LLMInput` shape and gets back `LLMEstimate`.
- **Token usage extension:** The `LLMEstimate` interface needs an optional `usage` field. This is a backward-compatible addition. The Gemini SDK exposes `response.usageMetadata` and OpenAI exposes `response.usage`.
- **File structure:** New files should live under `src/eval/` (e.g., `src/eval/export.ts`, `src/eval/runner.ts`, `src/eval/metrics.ts`, `src/eval/report.ts`).
- **CLI integration:** Extend the existing `src/cli.ts` with an `eval` subcommand that dispatches to `export` or `run`.
- **Parallelism:** Use `Promise.all()` across models, with each model processing items sequentially via a `for` loop. This avoids per-model rate limiting while still being faster than fully sequential.
- **JSONL format:** One JSON object per line, no trailing commas. Use `Bun.file().text()` to read + split by newline.

## 8. Success Metrics

- Able to run a full eval across 3+ models on 10+ fixture items and produce a valid JSON report
- Report clearly shows which model has the best MAPE and at what cost
- Confidence correlation reveals whether any model's self-reported confidence is meaningfully predictive
- Total eval runtime for 10 items x 4 models completes in under 2 minutes (parallel execution)

## 9. Open Questions

- Should the pricing config (`evals/pricing.json`) be checked into the repo, or gitignored since prices change frequently?
- Should the eval runner support a `--concurrency` flag to limit how many models run in parallel (to avoid hitting aggregate rate limits across providers)?
- Is JSONL the best format for fixtures, or would a single JSON array be easier to edit manually?
