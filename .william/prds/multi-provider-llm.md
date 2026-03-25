# PRD: Multi-Provider LLM Support

## Introduction

Replace the hardcoded Gemini integration with a provider-agnostic LLM layer that supports multiple AI providers (starting with OpenAI and Gemini). The primary motivation is cost optimization and flexibility — GPT-4o mini is a strong candidate for cost-effective pricing estimates, but the system should make it easy to test and swap models across providers without code changes. The default provider will be OpenAI with GPT-4o mini.

## Goals

- Abstract the LLM integration behind a provider-agnostic interface so new providers can be added with minimal effort
- Support OpenAI (GPT-4o mini default) and Gemini as initial providers
- Allow provider/model selection via config file with CLI override
- Use a single shared prompt template across all providers
- Keep the existing prompt, response format, and blending logic unchanged
- Replace the `@google/genai` SDK with the `openai` npm package for the OpenAI adapter; keep `@google/genai` for Gemini
- Default new installations to `openai/gpt-4o-mini`

## User Stories

### US-001: Create LLM Provider Interface

**Description:** As a developer, I want a shared TypeScript interface that all LLM providers implement so the analysis code doesn't need to know which provider is active.

**Acceptance Criteria:**

- [ ] An `LLMProvider` interface exists with a method like `estimate(input: LLMInput): Promise<LLMEstimate>`
- [ ] `LLMInput` matches the existing `GeminiInput` shape (productName, upc, condition, retailPrice, category, description)
- [ ] `LLMEstimate` matches the existing `GeminiEstimate` shape (low, mid, high, confidence, reasoning, comparables)
- [ ] The prompt-building function (`buildPrompt`) is shared across providers, not duplicated
- [ ] The JSON response parsing logic is shared across providers
- [ ] Typecheck passes

### US-002: Implement OpenAI Adapter

**Description:** As a user, I want to use OpenAI models (especially GPT-4o mini) for pricing estimates so I can reduce costs while maintaining quality.

**Acceptance Criteria:**

- [ ] An OpenAI adapter implements the `LLMProvider` interface
- [ ] It uses the `openai` npm package to call the OpenAI Chat Completions API
- [ ] The adapter sends the shared prompt as a user message
- [ ] Temperature is set to 0.1 (matching current Gemini behavior)
- [ ] The adapter parses the JSON response using the shared `extractJson` + validation logic
- [ ] `openai` package is added to `package.json` dependencies
- [ ] Typecheck passes

### US-003: Refactor Gemini Adapter

**Description:** As a developer, I want the existing Gemini code refactored to implement the new `LLMProvider` interface so both providers are interchangeable.

**Acceptance Criteria:**

- [ ] A Gemini adapter implements the `LLMProvider` interface
- [ ] The existing `@google/genai` SDK usage is preserved (no SDK change for Gemini)
- [ ] The adapter delegates prompt building and response parsing to the shared utilities
- [ ] All existing Gemini behavior (temperature 0.1, JSON extraction, validation) is preserved
- [ ] The old `gemini.ts` module is replaced or refactored into the new structure
- [ ] Typecheck passes

### US-004: Update Config for Provider/Model Selection

**Description:** As a user, I want to set my preferred provider and model in `config.json` so I don't have to specify it every time.

**Acceptance Criteria:**

- [ ] The `gemini_model` config field is replaced with `llm_model` (format: `"provider/model-name"`, e.g. `"openai/gpt-4o-mini"`)
- [ ] Default value is `"openai/gpt-4o-mini"` when not specified in config
- [ ] Config validation accepts the `"provider/model"` format and rejects invalid formats
- [ ] Backward compatibility: if `gemini_model` is present but `llm_model` is not, treat it as `"gemini/{gemini_model}"` with a deprecation warning
- [ ] The config type (`ConfigFile`) is updated to reflect the new field
- [ ] Typecheck passes

### US-005: Add CLI Override for Model

**Description:** As a user, I want to override the configured model on a per-run basis via a CLI flag so I can quickly test different models.

**Acceptance Criteria:**

- [ ] A `--model` CLI flag accepts a `"provider/model"` string (e.g. `--model gemini/gemini-2.5-flash`)
- [ ] The CLI flag overrides the `llm_model` value from config for that run
- [ ] The flag is parsed in `parseCliOverrides` and flows through to the analysis
- [ ] Invalid format (missing `/`) produces a clear error message
- [ ] Typecheck passes

### US-006: Wire Up Provider Selection in Analysis

**Description:** As a developer, I want `analyzeItem` to use the configured provider/model instead of hardcoding Gemini so the abstraction is actually used end-to-end.

**Acceptance Criteria:**

- [ ] `analyzeItem` resolves the provider from config (or CLI override) and instantiates the correct adapter
- [ ] The correct API key env var is checked based on the selected provider (`OPENAI_API_KEY` for OpenAI, `GEMINI_API_KEY` for Gemini)
- [ ] If the required API key is missing, a warning is logged and AI estimation is skipped (analysis continues with eBay only)
- [ ] The `llm_provider` field stored in the database reflects the actual provider used (e.g. `"openai"`, `"gemini"`)
- [ ] All existing blending, max-bid, and deal-score logic works unchanged regardless of provider
- [ ] Typecheck passes

### US-007: Update Telegram Bot

**Description:** As a user, I want the Telegram bot to work with whichever LLM provider is configured, not just Gemini.

**Acceptance Criteria:**

- [ ] The Telegram bot uses the same provider-resolution logic as the CLI
- [ ] No Gemini-specific code remains in the Telegram bot path
- [ ] Typecheck passes

### US-008: Update Tests

**Description:** As a developer, I want the test suite updated to cover the new provider abstraction and both adapters.

**Acceptance Criteria:**

- [ ] Existing `gemini.test.ts` tests are updated or replaced to test the shared prompt/parsing logic
- [ ] Tests exist for the OpenAI adapter (mocked API responses)
- [ ] Tests exist for the Gemini adapter (mocked API responses)
- [ ] Tests verify provider resolution from config (including `"provider/model"` parsing)
- [ ] Tests verify the `--model` CLI flag override
- [ ] Tests verify backward compatibility with `gemini_model` config field
- [ ] Tests verify graceful handling of missing API keys
- [ ] All tests pass

## Functional Requirements

- FR-1: Define an `LLMProvider` interface with an `estimate(input: LLMInput): Promise<LLMEstimate>` method
- FR-2: Extract `buildPrompt` and `extractJson` + response validation into shared utilities (e.g. `src/llm/prompt.ts`)
- FR-3: Implement an OpenAI adapter using the `openai` npm package's Chat Completions API
- FR-4: Refactor the existing Gemini code into a Gemini adapter implementing `LLMProvider`
- FR-5: Replace the `gemini_model` config field with `llm_model` using `"provider/model"` format, defaulting to `"openai/gpt-4o-mini"`
- FR-6: If `gemini_model` exists in config but `llm_model` does not, auto-migrate to `"gemini/{gemini_model}"` and log a deprecation warning
- FR-7: Add a `--model provider/model` CLI flag that overrides the config value for a single run
- FR-8: Resolve the provider adapter at runtime based on the `"provider/"` prefix of the configured model string
- FR-9: Read `OPENAI_API_KEY` env var for the OpenAI adapter; continue reading `GEMINI_API_KEY` for the Gemini adapter
- FR-10: If the required API key for the selected provider is missing, log a warning and skip AI estimation (do not hard-error)
- FR-11: Store the actual provider name (e.g. `"openai"`, `"gemini"`) in the `llm_provider` database column
- FR-12: All existing analysis logic (blending, max-bid calculation, deal-score, display formatting) must work identically regardless of which provider produced the estimate
- FR-13: Both adapters must use temperature 0.1 and the same shared prompt

## Non-Goals

- No support for providers beyond OpenAI and Gemini in this iteration
- No per-provider prompt customization — one prompt for all
- No streaming responses — continue using simple request/response
- No automatic fallback to a secondary provider if the primary fails (skip AI instead)
- No cost tracking or token usage monitoring
- No changes to the eBay integration, blending formula, or max-bid calculation
- No changes to the database schema (existing `llm_provider`, `llm_estimate_*`, `llm_confidence`, `llm_reasoning`, `llm_comparables` columns are sufficient)

## Edge Cases & Error Handling

- **Invalid `llm_model` format:** If the config value or CLI flag doesn't contain a `/`, emit a clear error: `"llm_model must be in 'provider/model' format (e.g. openai/gpt-4o-mini)"`
- **Unknown provider prefix:** If the provider prefix isn't `"openai"` or `"gemini"`, emit: `"Unknown LLM provider: {provider}. Supported: openai, gemini"`
- **Missing API key:** Log `"Warning: {PROVIDER}_API_KEY not set. Skipping AI estimate."` and proceed with eBay-only analysis
- **Provider API error (rate limit, timeout, etc.):** Catch the error, log it, skip AI estimation for that item, continue analysis
- **Backward compat — old `gemini_model` field:** If `config.json` has `gemini_model: "gemini-2.5-flash"` but no `llm_model`, resolve to `"gemini/gemini-2.5-flash"` and log: `"Deprecation: 'gemini_model' config field is deprecated. Use 'llm_model: gemini/gemini-2.5-flash' instead."`
- **Both `gemini_model` and `llm_model` present:** `llm_model` takes precedence, ignore `gemini_model`
- **OpenAI response not valid JSON:** Same handling as current Gemini — `extractJson` attempts to parse, throws if invalid, caught by the caller

## Technical Considerations

- **File structure:** Consider organizing as `src/llm/index.ts` (interface + factory), `src/llm/prompt.ts` (shared prompt + parsing), `src/llm/openai.ts`, `src/llm/gemini.ts`. Or keep it flat — the codebase is small enough either way.
- **OpenAI SDK:** Use the `openai` npm package. The Chat Completions API with `response_format: { type: "json_object" }` can enforce JSON output, which may be more reliable than parsing freeform text. However, this changes behavior from Gemini — test both paths.
- **Config migration:** The backward-compat logic for `gemini_model` should be in `loadConfigFile`, not scattered across consumers.
- **Adapter instantiation:** A simple factory function (`createProvider(model: string, apiKey: string): LLMProvider`) that splits on `/` and returns the right adapter is sufficient. No need for a registry or plugin system.
- **Existing code to modify:** `src/gemini.ts` (refactor), `src/analyze.ts` (use abstraction), `src/config.ts` (new field + compat), `src/cli.ts` (new flag), `src/telegram.ts` (use abstraction), `package.json` (add `openai` dep)

## Success Metrics

- OpenAI adapter produces valid pricing estimates for the same items currently analyzed with Gemini
- GPT-4o mini per-item cost is measurably lower than Gemini for comparable quality
- Switching between providers requires only a config change or CLI flag — no code changes
- All existing tests continue to pass
- New provider-specific tests achieve full coverage of both adapters
- No regression in analysis quality (blended estimates, max-bid calculations remain correct)

## Open Questions

- Should the OpenAI adapter use `response_format: { type: "json_object" }` to enforce JSON output, or rely on the same freeform prompt + `extractJson` parsing used by Gemini? JSON mode is more reliable but provider-specific.
- Is GPT-4o mini's context window sufficient for the current prompt + product descriptions, or should there be a truncation strategy for very long descriptions?
- Should we add a `--compare` mode that runs both providers on the same item and shows a side-by-side comparison to help evaluate quality?
