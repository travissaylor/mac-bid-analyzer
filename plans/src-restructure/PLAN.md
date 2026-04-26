# Plan: Restructure `src/` into Feature Folders

## Goal

Reorganize the backend source tree so that adding a feature, finding existing code, or onboarding new context (human or AI) doesn't require holding all 11 top-level modules in working memory. Reduce file sizes for the three modules that have outgrown a single file (`analyze.ts`, `format.ts`, `cli.ts`), and remove dead code (`eval/`, `gemini.ts`).

## Context

The codebase is ~16k lines of TypeScript split between `src/` (backend: CLI, HTTP server, DB, LLM, eBay, Telegram bot) and `extension/` (Chrome + Safari MV3). The extension is already cleanly factored into `chrome/`, `safari/`, and a fat `shared/` library; that work is **out of scope** for this plan.

`src/`, by contrast, is flat: 11 top-level `.ts` files plus two subfolders (`llm/`, `eval/`). Three modules are doing too much:

- `src/analyze.ts` (~800 lines) — URL parsing, lot resolution, eBay search cascade, LLM orchestration, image analysis, DB writes.
- `src/format.ts` (~730 lines) — text, HTML, and table renderers in one file.
- `src/cli.ts` (~400 lines) — every subcommand inlined; imports 11+ modules; every new command touches it.

Two cleanup items live alongside the restructure:

- `src/gemini.ts` (~138 lines) is a legacy duplicate of `src/llm/gemini.ts`. Only its own test file imports it. The LLM provider abstraction in `src/llm/index.ts` is the canonical path now.
- `src/eval/` (~1,000 lines, 7 files) and the top-level `evals/` data folder were a one-time benchmark to pick an LLM. The chosen model won. The harness is not wired to evolve with the rest of the codebase and currently has no production use beyond the `eval` CLI subcommand.

## Constraints and pre-decided facts

- **Single repo. No monorepo.** At ~16k lines with `extension/` already isolated by HTTP, Bun workspaces would add tooling overhead with no payoff.
- **Extension stays untouched.** No shared package between `src/` and `extension/`. A small amount of duplication (e.g., `lot-url.ts` parsing logic) is acceptable for now.
- **`openai` dependency stays.** `src/llm/openai.ts` is a real runtime provider behind the `LLMProvider` factory, not just eval tooling. The user can switch via config.
- **Tests move with their source files.** `*.test.ts` files live next to the modules they test (existing convention); when a module is split into a folder, its test file becomes the folder's `*.test.ts` or splits alongside.
- **Bun + single `tsconfig.json`.** No build/config changes required by this restructure.
- **Commit style.** Per repo convention, each phase below is one PR titled `[Short title]`, no Claude attribution.

## Architecture decisions

### Target `src/` layout

```
src/
  main.ts                         # NEW: thin entry, delegates to cli/
  cli/
    index.ts                      # arg parsing, subcommand dispatch
    commands/
      analyze.ts                  # `analyze` subcommand
      results.ts                  # `results` subcommand
      detail.ts                   # `detail` subcommand
      telegram.ts                 # `telegram` subcommand
      server.ts                   # `server` subcommand
    cli.test.ts
  analyze/
    index.ts                      # exports analyzeItem (public API)
    parse.ts                      # parseLotId, resolveLotId, URL helpers
    search.ts                     # eBay search cascade orchestration
    estimate.ts                   # LLM price estimation orchestration
    images.ts                     # multi-image analysis coordination
    analyze.test.ts (split as needed)
  format/
    index.ts                      # exports the public renderers
    text.ts                       # toTextSummary + plain-text helpers
    html.ts                       # toHtmlDetail + HTML helpers
    table.ts                      # tabular renderers
    display.ts                    # resolveDisplayData (shared transform)
    format.test.ts (split as needed)
  llm/                            # unchanged — already well-organized
  server.ts                       # unchanged (200 lines, fine as a file)
  telegram.ts                     # unchanged
  sync.ts                         # unchanged
  db.ts                           # unchanged
  ebay.ts                         # unchanged
  config.ts                       # unchanged
  location.ts                     # unchanged
  shared/
    types.ts                      # NEW: cross-module contracts (AnalyzedItem, LotInfo, etc.)
```

Removed:

- `src/gemini.ts` and `src/gemini.test.ts` (dead duplicates of `src/llm/gemini.ts`)
- `src/eval/` (entire folder + 7 files)
- `evals/` top-level data folder (`fixtures.jsonl`, `pricing.json`, `results/`)
- `eval` subcommand and its imports in `cli.ts`

### What stays a single file vs. becomes a folder

A module gets promoted to a folder only if (a) it's >500 lines or (b) it has multiple distinct concerns that someone reading the file has to mentally separate. By that rule:

- **Promote to folder:** `analyze.ts`, `format.ts`, `cli.ts`.
- **Stay a single file:** `db.ts` (450 lines, one concern), `ebay.ts` (360 lines, one concern), `server.ts` (200 lines), `telegram.ts` (270 lines), `config.ts` (260 lines), `sync.ts` (80 lines), `location.ts` (100 lines).

This keeps churn proportional to actual pain. Folders are not a goal in themselves.

### `src/shared/types.ts`

A single types module for cross-module contracts that are currently re-declared or imported from feature modules:

- `AnalyzedItem`, `AnalyzeResult` (currently in `analyze.ts`)
- `LotInfo`, `LotId` (currently in `analyze.ts`)
- `EbayPriceResult` (currently in `ebay.ts`)
- DB row types (currently in `db.ts`)

Feature modules keep their own internal types; only types crossing module boundaries move to `shared/types.ts`. The goal is fewer cross-feature imports, not a god-types file.

### CLI command registry

`src/cli/index.ts` parses `argv[2]` and dispatches to a command module:

```ts
const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  analyze: (await import("./commands/analyze")).run,
  results: (await import("./commands/results")).run,
  detail: (await import("./commands/detail")).run,
  telegram: (await import("./commands/telegram")).run,
  server: (await import("./commands/server")).run,
};
```

Dynamic imports keep startup fast (e.g., `analyze` doesn't load Telegraf). Each command exports a `run(args: string[]): Promise<number>` function. No framework, no plugin system — just a switch with files.

### `package.json` updates

- `"start": "bun run src/main.ts"` (replaces `bun run src/cli.ts`)
- Remove `eval` subcommand documentation if it appears anywhere in `docs/`.
- `@google/genai` and `openai` deps stay (both used by `src/llm/`).

## Sequencing

Each phase is one PR. Land in order. Each phase is independently revertable.

### Phase 1 — Cleanup (no restructure)

Goal: delete dead code first so we're not moving it around in later phases.

1. Delete `src/gemini.ts` and `src/gemini.test.ts`. Verify no imports outside the test (`grep -rn "from.*['\"]\\./gemini['\"]\\|from.*['\"]\\./gemini\\.ts['\"]" src extension`).
2. Remove the `eval` subcommand from `src/cli.ts` (subcommand handler + the two imports on lines 11–12: `exportFixtures`, `runEval`, `saveReport`, `printSummaryTable`, `printSearchMetrics`).
3. Delete `src/eval/` folder (7 files including tests).
4. Delete top-level `evals/` data folder (`fixtures.jsonl`, `pricing.json`, `results/`).
5. Search `docs/` for any references to the eval subcommand and remove them.
6. Run `bun run typecheck` and `bun test`.
7. Commit: `[Remove dead eval harness and legacy gemini module]`.

### Phase 2 — Add `src/shared/types.ts`

Goal: pull cross-feature types into one place before splitting modules, so the splits don't churn imports twice.

1. Create `src/shared/types.ts`.
2. Move (do not copy) cross-module types: `AnalyzedItem`, `AnalyzeResult`, `LotInfo`, `LotId`, `EbayPriceResult`, DB row types.
3. Update imports across `src/` to point at `./shared/types` (or `../shared/types`).
4. Internal-only types stay in their feature modules.
5. Run `bun run typecheck` and `bun test`.
6. Commit: `[Consolidate cross-module types into shared/types.ts]`.

### Phase 3 — Split `analyze.ts` into `src/analyze/`

Goal: break the 800-line orchestrator into single-purpose files.

1. Create `src/analyze/` folder.
2. Move pieces:
   - `parse.ts`: `parseLotId`, `resolveLotId`, URL pattern helpers.
   - `search.ts`: eBay search cascade (UPC → LLM-generated query → relaxation), and cascade result types.
   - `estimate.ts`: LLM price estimation orchestration (provider call, retry, JSON parsing).
   - `images.ts`: multi-image analysis coordination (calls into `src/llm/image-prompt.ts`).
   - `index.ts`: exports `analyzeItem` and any other public entry points; re-exports types from `shared/types.ts`.
3. Split `analyze.test.ts` to mirror the new structure (or keep one test file if cohesive).
4. Update imports in `cli.ts`, `server.ts`, `telegram.ts`.
5. Run `bun run typecheck` and `bun test`.
6. Commit: `[Split analyze.ts into analyze/ feature folder]`.

### Phase 4 — Split `format.ts` into `src/format/`

Goal: separate renderers so adding a new output format doesn't mean touching a 730-line file.

1. Create `src/format/` folder.
2. Move pieces:
   - `display.ts`: `resolveDisplayData` and the data-shape helpers used by all renderers.
   - `text.ts`: `toTextSummary` + plain-text helpers.
   - `html.ts`: `toHtmlDetail` + HTML helpers.
   - `table.ts`: tabular renderers.
   - `index.ts`: re-exports the public surface.
3. Split `format.test.ts` to mirror, or keep one if cohesive.
4. Update imports in `cli.ts`, `server.ts`, `telegram.ts`.
5. Run `bun run typecheck` and `bun test`.
6. Commit: `[Split format.ts into format/ feature folder]`.

### Phase 5 — Split `cli.ts` into `src/cli/`

Goal: per-subcommand files + a thin dispatcher; `main.ts` becomes the entry point.

1. Create `src/cli/` folder with `commands/` subfolder.
2. Create one file per subcommand under `commands/`. Each exports `async function run(args: string[]): Promise<number>`.
3. Move shared CLI helpers (arg parsing, log helpers, exit codes) to `src/cli/index.ts`.
4. Create `src/main.ts` as the entry point: parse argv, dispatch via the command registry.
5. Update `package.json` `"start"` script to `bun run src/main.ts`.
6. Update any docs that reference `src/cli.ts` as the entry point.
7. Run `bun run typecheck` and `bun test`. Manually invoke each subcommand once to confirm wiring.
8. Commit: `[Split cli.ts into per-subcommand files]`.

### Phase 6 — Optional cleanup pass (only if anything still feels off)

Reserved for follow-ups discovered during phases 3–5. Examples that *might* surface but are not committed-to:

- `db.ts` schema constants extracted to `db/schema.ts` if the file grows.
- `telegram.ts` message handlers split if more commands get added.
- An `index.ts` barrel for `shared/` if imports get noisy.

Default to **not** doing any of these unless friction is real.

## Risks and unknowns

- **Test coverage gaps after deletion**: removing `src/eval/` removes its test files too. Confirm no production module silently relies on an eval-only utility before deleting (the Explore report says no, but verify with `grep` in phase 1).
- **Import path churn**: phases 3–5 each touch many import statements. Run `bun run typecheck` after every move; the compiler is the safety net.
- **Dynamic CLI imports**: in phase 5, `await import()` inside the registry needs to work with Bun's resolver. Bun supports this natively, but verify on a real subcommand invocation, not just typecheck.
- **`src/main.ts` rename surprise**: anything outside this repo invoking `bun run src/cli.ts` directly (cron jobs, systemd units, deployment scripts on the home server) will break. Check the Ubuntu server's launch scripts before phase 5.
- **`format.test.ts` and `analyze.test.ts` may be hard to split cleanly**: if a single test exercises the whole pipeline, splitting tests by sub-module may require restructuring fixtures. Acceptable to leave one test file per feature folder if splitting fights the existing test design.
- **Shadowed types in `shared/types.ts`**: when consolidating, be careful that what looks like the same type in two modules really *is* the same. If two modules define a "LotInfo" with different shapes, keep them separate and rename one.

## Out of scope

- Monorepo / Bun workspaces.
- Any change to `extension/`.
- Removing the `openai` dependency or any LLM provider.
- Database migrations or schema changes.
- New features in the analyze, server, or CLI surface.
- Replacing the eval harness with something newer (it's just being deleted).
- Performance work on the LLM or eBay clients.
- Changing the build pipeline or `tsconfig.json`.
