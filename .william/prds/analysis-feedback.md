# PRD: Human-in-the-Loop Analysis Feedback

## 1. Introduction/Overview

The mac.bid analyzer sometimes produces wrong analyses — wrong search query, wrong eBay comps, wrong product identification, overconfident estimates, false-positive image red flags. Today the only remedy is to give up on the number, because the user has no way to tell the pipeline *why* it's wrong.

This feature adds a single free-text "correction / context" field per lot. When set, the feedback is persisted on the lot's row, injected into every LLM prompt in the pipeline (search-query generation, image analysis, price estimation), and causes the pipeline to re-run. The next analysis incorporates the human-supplied context, and the correction stays on the row so subsequent re-runs (e.g. after a bid moves) continue to use it.

The feature is exposed through both the Chrome extension side panel (primary surface) and the CLI, so the user can add feedback from whichever tool they're in.

## 2. Goals

- Let the user correct wrong analyses by adding context, not by hand-editing output fields
- Make corrections durable — once written, they're re-applied on every future re-run of the same lot
- Keep the correction mechanism orthogonal to existing data sources (no changes to `analysis_source` enum, no new data tables)
- Preserve the invariant "the stored analysis always reflects the currently-stored feedback" — no drift between what the user typed and what the LLM saw
- Allow feedback to override the condition-based manual-review gate, because typing feedback *is* the human review

## 3. User Stories

### US-001: Persist user feedback on analyzed items

**Description:** As a developer, I need the database to store a per-lot feedback string so the correction survives re-runs and tool boundaries.

**Acceptance Criteria:**

- [ ] Add a nullable `user_feedback TEXT` column to the `analyzed_items` table via the existing schema/migration pattern in `src/db.ts`
- [ ] Add `user_feedback: string | null` to the `AnalyzedItem` type
- [ ] `getItemByLotId` reads the column
- [ ] `upsertAnalyzedItem` writes the column (preserving existing value when the caller does not set one — handled by `analyzeItem` resolution, see US-002)
- [ ] Unit tests cover insert with feedback, insert without feedback, and read-back
- [ ] Typecheck and lint pass

---

### US-002: Inject feedback into the analysis pipeline

**Depends on:** US-001

**Description:** As a developer, I want `analyzeItem` to accept a three-state `userFeedback` option and weave it into every LLM prompt so the LLM sees the user's correction on every run.

**Acceptance Criteria:**

- [ ] `analyzeItem` options gain `userFeedback?: string | null` where `undefined` means preserve existing persisted value, `null` means clear, and a string means set-and-use
- [ ] Three-state resolution happens in one place inside `analyzeItem` (reading the row it already reads for the cache check) and the resolved value is persisted back on the output row
- [ ] When the resolved feedback is non-empty, it is appended as a trailing block labeled `User context (treat as authoritative):\n{feedback}` to:
  - [ ] The search-query generation prompt (`src/llm/search-query` flow)
  - [ ] The image analysis prompt (`provider.analyzeImages` call in `src/analyze.ts`)
  - [ ] The price estimate prompt (`provider.estimate` call in `src/analyze.ts`)
- [ ] The price estimate prompt additionally includes one steering line: "If user context contradicts your own read of the product, prefer the user context." — placed only on that prompt, not the other two
- [ ] When the resolved feedback is non-empty, the condition-based manual-review gate at `src/analyze.ts:310-316` is suppressed (`needsManualReview` is not set to `true` from the config list). Image-derived manual-review reasons (`src/analyze.ts:445-457`) still fire as normal
- [ ] When the resolved feedback is empty/null, behavior is strictly unchanged from today (additive-only invariant)
- [ ] Unit tests cover: (a) preserve semantics when option is `undefined`, (b) clear semantics when option is `null`, (c) set semantics with a string, (d) suppression of condition-based manual review when feedback present, (e) image-derived review still fires even with feedback present
- [ ] Typecheck and lint pass

---

### US-003: Extend the HTTP API with user feedback

**Depends on:** US-002

**Description:** As a developer, I want `POST /api/analyze` to accept an optional `user_feedback` field so the Chrome extension can set, update, clear, or leave alone the feedback per request.

**Acceptance Criteria:**

- [ ] `POST /api/analyze` request body type gains `user_feedback?: string | null`
- [ ] Server normalizes the three states before calling `analyzeItem`: field absent → pass `undefined` (preserve); field is `""` → pass `null` (clear); field is a non-empty string → pass the string (set)
- [ ] Setting or clearing (i.e. any provided value) implies `force: true` at the server layer — the server forces a re-run regardless of the client-supplied `force` flag when `user_feedback` is present in the body. If the body has no `user_feedback` key at all, the existing `force` semantics are preserved
- [ ] `GET /api/lot/:lotId` returns the `user_feedback` field as part of the `AnalyzedItem` JSON
- [ ] No new endpoints are added
- [ ] No change to `analysis_source` enum values
- [ ] Integration tests cover the three input states and verify the persisted row matches
- [ ] Typecheck and lint pass

---

### US-004: Add `--feedback` to the CLI `analyze` subcommand

**Depends on:** US-002

**Description:** As a user, I want to pass feedback from the CLI so I can iterate on corrections without switching to the browser.

**Acceptance Criteria:**

- [ ] `bun run src/cli.ts analyze <input> --feedback "text"` sets the feedback and re-runs
- [ ] `bun run src/cli.ts analyze <input> --feedback ""` clears the feedback and re-runs
- [ ] `bun run src/cli.ts analyze <input>` without the flag preserves any existing persisted feedback (uses `undefined`)
- [ ] Passing `--feedback` implies `--force` at the CLI layer, mirroring US-003
- [ ] No new CLI subcommand is added (no `feedback` subcommand)
- [ ] Unit tests cover flag parsing for all three states
- [ ] Typecheck and lint pass

---

### US-005: Side panel textarea, re-analyze button, and "Corrected" indicator

**Depends on:** US-003

**Description:** As a user, I want to type corrections directly into the side panel and re-run the analysis in one click, and I want a visual cue that tells me the current analysis was informed by my feedback.

**Acceptance Criteria:**

- [ ] A labeled textarea "Correction / context" is rendered in the side panel *above* the analysis results, visible both pre-analysis and post-analysis
- [ ] When the lot has a persisted `user_feedback` value, the textarea is pre-filled with it on panel load
- [ ] A single button labeled "Save & re-analyze" sits directly under the textarea; there is no "save without re-running" button
- [ ] Clicking the button posts to `POST /api/analyze` with `{ input, user_feedback: <textarea value> }` — the client does not set `force` (the server handles that, per US-003)
- [ ] An empty textarea posts `user_feedback: ""` (clear), a non-empty textarea posts the string (set)
- [ ] Loading, success, and error states reuse the existing analyze-button patterns from US-004/US-007 of the chrome-extension PRD
- [ ] When the rendered analysis has a non-null `user_feedback` field, a small "Corrected" pill is shown near the analysis header (near the "AI estimate" label or lot name)
- [ ] The pre-filled textarea and the pill together serve as the passive indicator; no separate history UI is added
- [ ] Manual smoke test: loading a lot with persisted feedback displays it in the textarea; submitting new text replaces it; submitting empty text clears it
- [ ] No new Chrome APIs or permissions are required beyond what the existing extension already declares

---

### US-006: Feedback plumbing smoke eval and additive-invariant regression guard

**Depends on:** US-002

**Description:** As a developer, I want a minimal eval that catches the worst failure mode — feedback silently dropped before reaching the LLM — and a regression check that proves adding the `user_feedback` plumbing does not change existing output when no feedback is supplied.

**Acceptance Criteria:**

- [ ] One new eval case in `src/eval/` (or `evals/`, matching the existing layout) runs `analyzeItem` on a synthetic or fixture lot with a distinctive feedback string (e.g. containing a rare token like "ZZQX-2022-model")
- [ ] The eval asserts the distinctive token appears in the returned `llm_reasoning` (or equivalently that the LLM acknowledged the user context). It does not assert price correctness
- [ ] One existing eval case is pinned with `userFeedback: undefined` (or equivalently, the default) and asserts the output is identical to pre-feedback behavior for that case — the "strictly additive" invariant
- [ ] Evals run in the existing eval harness with no new infrastructure
- [ ] Typecheck and lint pass

## 4. Functional Requirements

- **FR-1:** The `analyzed_items` table must have a nullable `user_feedback TEXT` column.
- **FR-2:** `analyzeItem` must accept an optional `userFeedback` parameter with three states: `undefined` (preserve), `null` (clear), string (set). Resolution happens once per call, against the existing row read, and the resolved value is persisted on the output row.
- **FR-3:** When the resolved feedback is non-empty, it must be appended to the search-query prompt, the image analysis prompt, and the price estimate prompt as a `User context (treat as authoritative)` block.
- **FR-4:** The price estimate prompt must additionally include the line: "If user context contradicts your own read of the product, prefer the user context." This line appears only on the estimate prompt.
- **FR-5:** When the resolved feedback is non-empty, the condition-based manual-review short-circuit (driven by `config.manual_review_conditions`) must be suppressed. Image-analysis-derived manual-review reasons must still apply.
- **FR-6:** `POST /api/analyze` must accept an optional `user_feedback` field in the JSON body. When present (including empty string), the server must force a re-run regardless of the client-supplied `force` flag.
- **FR-7:** `GET /api/lot/:lotId` must include `user_feedback` in the returned `AnalyzedItem` JSON.
- **FR-8:** The CLI `analyze` subcommand must accept a `--feedback "text"` flag with the same three-state semantics as the API, and passing the flag must imply `--force`.
- **FR-9:** The side panel must render a "Correction / context" textarea above the analysis results, pre-filled from the lot's persisted `user_feedback`, with a single "Save & re-analyze" button.
- **FR-10:** The side panel must show a "Corrected" pill near the analysis header when the rendered lot's `user_feedback` is non-null.
- **FR-11:** When no feedback is supplied and none is persisted, the pipeline output must be identical to pre-feature behavior.

## 5. Non-Goals (Out of Scope)

- **No feedback history or stacking.** One current feedback string per lot. Editing replaces; no audit trail.
- **No per-prompt targeted feedback fields.** One text box that fans out to all three prompts.
- **No save-without-re-run.** Saving always implies re-running, to preserve the "stored analysis reflects stored feedback" invariant.
- **No changes to the `analysis_source` enum.** Feedback is orthogonal to data source; the existing `"ai"` / `"ebay"` / `"manual_review"` / `"none"` values are untouched.
- **No override of image-analysis-derived manual-review reasons.** Only condition-based review gates are suppressed by feedback.
- **No quality eval suite.** No corpus of known-wrong lots paired with known-correct prices. Only a plumbing smoke test and an additive-invariant regression guard.
- **No new CLI subcommand.** Just a flag on the existing `analyze` command.
- **No new HTTP endpoints.** The feature extends `POST /api/analyze` and `GET /api/lot/:lotId` only.
- **No automatic feedback clearing.** Feedback persists until the user clears it explicitly.
- **No server-side length limit enforcement.** Reasonable caller behavior is assumed for a personal tool.

## 6. Technical Considerations

- **Three-state resolution lives in `analyzeItem`.** The server and the CLI both normalize their inputs into the `userFeedback?: string | null` shape and hand it off. This keeps a single owner for the preserve/clear/set logic.
- **`analyzeItem` already reads the existing row** for the cache-check path — extend that read to also retrieve `user_feedback`, so resolution is free.
- **Prompt modification points** in `src/analyze.ts`:
  - Search query generation around `src/analyze.ts:354-365`
  - Image analysis around `src/analyze.ts:326-349`
  - Price estimate around `src/analyze.ts:404-433`
- **Condition-based review suppression point:** `src/analyze.ts:310-316`. The suppression must not touch the image-derived review logic at `src/analyze.ts:445-457`.
- **`llm_reasoning` as free explainability.** Because the estimate LLM will naturally reference the injected user context in its reasoning string, the existing US-005 "reasoning" display in the side panel doubles as a verification signal — the user can tell whether their correction was actually used.
- **No CORS or auth changes required** — the existing `Authorization: Bearer` and CORS setup from the chrome-extension PRD covers the extended endpoint.
- **No schema migration tooling beyond what `src/db.ts` already uses.** Follow the existing column-addition pattern.

## 7. Success Metrics

- A lot with a wrong first-pass analysis can be corrected with one textarea edit and one button click, and the re-run reflects the correction in under 30 seconds (same budget as a normal analyze).
- Re-visiting a corrected lot later (after a bid moves) shows the textarea pre-filled and produces an analysis that still honors the feedback, with no re-typing.
- Zero behavioral drift on existing evals when `userFeedback` is absent.
- `llm_reasoning` on a feedback-corrected lot visibly references the user's context (inspected manually and asserted by the smoke eval).

## 8. Open Questions

- Should the side panel optionally show a diff or before/after when a re-run produces a meaningfully different number (e.g. max bid moved by more than X%)? Not required to ship, but useful for trust-building.
- Should the CLI `detail` command (if it exists) print the persisted `user_feedback` alongside the other fields, for terminal-first inspection? Cheap to add if so; currently out of scope.
- Is there any value in exporting/importing feedback across machines (e.g. when the SQLite DB is rebuilt)? Only matters if the user develops a corpus of corrections worth preserving.
