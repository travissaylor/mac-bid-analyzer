# PRD: Telegram Bot Interface

## Introduction

Add a Telegram bot as the primary interface for mac-bid-analyzer, replacing the watchlist polling flow with on-demand analysis triggered by sending mac.bid links via Telegram. The bot provides formatted analysis results and an overview of active items, while the CLI is retained for local use.

## Goals

- Provide a Telegram bot interface for submitting mac.bid links and receiving analysis results
- Replace the watchlist polling flow with on-demand, user-initiated analysis
- Replace Ntfy notifications with Telegram as the sole notification channel
- Provide an `/active` command showing all open analyzed items with live data
- Remove all code related to the watchlist flow, Firebase auth, circuit breaker, and Ntfy
- Retain CLI `analyze`, `results`, and `detail` commands for local use

## User Stories

### US-001: Remove watchlist flow and dependencies

**Description:** As a developer, I want to remove the watchlist polling flow and its dependencies so the codebase is simplified to only the core analysis pipeline.

**Acceptance Criteria:**

- [ ] `src/watchlist.ts` is deleted
- [ ] `src/firebase-auth.ts` is deleted
- [ ] `src/circuit-breaker.ts` is deleted
- [ ] `src/live-update.ts` is deleted
- [ ] Ntfy integration is fully removed
- [ ] `.macbid-auth` and `.macbid-device-id` are removed or gitignored
- [ ] `MACBID_EMAIL` and `MACBID_PASSWORD` are removed from config requirements
- [ ] The `watchlist` CLI subcommand is removed from `src/cli.ts`
- [ ] All imports and references to removed modules are cleaned up
- [ ] No remaining references to Firebase auth, circuit breaker, or Ntfy in the codebase
- [ ] Typecheck passes
- [ ] Existing tests updated or removed as appropriate

### US-002: Create shared live data sync function

**Description:** As a developer, I need a shared function that syncs live bid/status data from the mac.bid API into the database for all open items, so both the CLI and Telegram bot can use it.

**Acceptance Criteria:**

- [ ] A function exists that queries all `is_open = true` items from the DB
- [ ] For each open item, it fetches current bid, total bids, watchers count, and open/closed status from the mac.bid DDB API
- [ ] Updated data is written back to the DB (including marking items as `is_open = false` when closed)
- [ ] `live_updated_at` timestamp is updated for each synced item
- [ ] The function is importable by both CLI and Telegram bot code
- [ ] Typecheck passes

### US-003: Update CLI results command to sync before display

**Description:** As a user, I want the CLI `results` command to show fresh data so I can trust the bid amounts are current.

**Acceptance Criteria:**

- [ ] Running `results` calls the shared live sync function before querying the DB
- [ ] Output reflects the freshly synced data
- [ ] Existing `results` flags (`--open`, `--deals`, `--review`) continue to work
- [ ] Typecheck passes

### US-004: Set up Telegram bot with polling and auth

**Description:** As a user, I want to start the Telegram bot via a CLI subcommand so it runs as a long-lived process on my home server.

**Acceptance Criteria:**

- [ ] `bun run src/cli.ts telegram` starts the bot in long-polling mode
- [ ] Bot requires `TELEGRAM_BOT_TOKEN` env var; exits with clear error if missing
- [ ] Bot requires `TELEGRAM_ALLOWED_USER_ID` env var; exits with clear error if missing
- [ ] Messages from unauthorized users are ignored or receive a "not authorized" reply
- [ ] The process stays alive and continues polling until killed
- [ ] Telegraf library is used for the bot framework
- [ ] Typecheck passes

### US-005: Analyze item via Telegram message

**Description:** As a user, I want to send a mac.bid URL or lot ID to the Telegram bot and receive a formatted analysis summary so I can make bidding decisions from my phone.

**Acceptance Criteria:**

- [ ] Sending a message containing a mac.bid URL (e.g., `https://mac.bid/auction/123/lot/456`) triggers analysis
- [ ] Sending a bare lot ID number triggers analysis
- [ ] Reuses existing URL/lot ID parsing logic from the CLI `analyze` command
- [ ] If the item is already analyzed in the DB, returns the cached result (does not re-analyze)
- [ ] Response is formatted in HTML using Telegram's supported HTML subset
- [ ] Summary format includes: product name, lot number, location, location tier, current bid, bid count, eBay median with comp count, AI estimate with confidence, recommended max bid, deal score, and analysis source
- [ ] Items flagged for manual review (USED/SALVAGE/DAMAGED) are analyzed but include a visible warning line
- [ ] Bot sends an "Analyzing..." message immediately upon receiving a valid URL/lot ID
- [ ] Bot edits the "Analyzing..." message with the formatted result when analysis completes
- [ ] If the item was already analyzed, the cached result is returned with a "Re-analyze" inline keyboard button alongside the "Full Details" button
- [ ] Tapping "Re-analyze" re-runs the analysis pipeline with force mode, sends "Re-analyzing..." feedback, and edits the message with fresh results
- [ ] Unrecognized messages receive a short "I don't understand" reply
- [ ] Typecheck passes

### US-006: Full details toggle via inline keyboard

**Description:** As a user, I want to tap a "Full Details" button on an analysis result to see the complete breakdown, and a "Summary" button to collapse back.

**Acceptance Criteria:**

- [ ] Analysis summary message includes a "Full Details" inline keyboard button
- [ ] Tapping "Full Details" edits the message to show the expanded view and replaces the button with "Summary"
- [ ] Expanded view includes: eBay low/mid/high with comp count, AI low/mid/high with confidence, cost breakdown (blended estimate, discount, lot fee, buyer's premium, sales tax, transfer cost), AI reasoning, and AI comparables
- [ ] Tapping "Summary" edits the message back to the summary view with the "Full Details" button
- [ ] Toggle works reliably without duplicate messages
- [ ] Typecheck passes

### US-007: Active items overview via /active command

**Description:** As a user, I want to send `/active` in Telegram to see an overview of all open items I've analyzed, sorted by deal score, so I can quickly assess my bidding opportunities.

**Acceptance Criteria:**

- [ ] `/active` command is registered with the bot
- [ ] Bot sends a "Syncing..." message immediately
- [ ] Bot runs the shared live sync function to refresh all open items
- [ ] Bot edits the "Syncing..." message with the formatted overview
- [ ] Overview starts with a summary line (e.g., "5 active items, 2 deals")
- [ ] Items are displayed as stacked cards sorted by deal score descending
- [ ] Each card shows: product name, current bid, recommended max bid, and deal score
- [ ] Items where current bid exceeds max bid show an "over max" indicator instead of deal score
- [ ] If no open items exist, shows an appropriate empty state message
- [ ] Only items with `is_open = true` are shown (closed items excluded)
- [ ] Typecheck passes

### US-008: Add /help command

**Description:** As a user, I want to send `/help` to the bot to see what commands are available and how to use it.

**Acceptance Criteria:**

- [ ] `/help` command is registered with the bot
- [ ] Response lists available commands: `/active` and `/help`
- [ ] Response explains that the bot accepts mac.bid URLs or bare lot IDs for analysis
- [ ] Formatted in HTML for consistency with other bot messages
- [ ] Typecheck passes

### US-009: Update configuration and documentation

**Description:** As a developer, I need the configuration and docs updated to reflect the new Telegram setup and removed watchlist dependencies.

**Acceptance Criteria:**

- [ ] `.env.example` includes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID`
- [ ] `.env.example` removes `MACBID_EMAIL`, `MACBID_PASSWORD`, and `NTFY_URL`
- [ ] `src/config.ts` validates the new Telegram env vars when the `telegram` subcommand is used
- [ ] `config.json` removes any watchlist or circuit breaker specific settings
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The `telegram` CLI subcommand starts a Telegraf bot in long-polling mode
- FR-2: The bot only processes messages from the user ID specified in `TELEGRAM_ALLOWED_USER_ID`
- FR-3: Messages containing a mac.bid URL trigger the existing `analyzeItem()` pipeline and return a formatted HTML summary
- FR-4: Messages containing only a number are treated as a lot ID and trigger analysis
- FR-5: Analysis summaries include an inline keyboard button to toggle between summary and full detail views by editing the message in place
- FR-6: The `/active` command syncs live data for all open items, then displays a summary line and stacked cards sorted by deal score descending
- FR-7: The live sync function is shared between the CLI `results` command and the Telegram `/active` command
- FR-8: The CLI `results` command syncs live data before displaying results
- FR-9: Already-analyzed items return cached results without re-running analysis
- FR-10: Items with USED/SALVAGE/DAMAGED condition are analyzed but display a manual review warning
- FR-11: Analysis errors are reported inline as Telegram messages (no circuit breaker or batch failure tracking)
- FR-12: All watchlist, Firebase auth, circuit breaker, Ntfy, and live-update modules are removed
- FR-13: A `/help` command lists available commands (`/active`, `/help`) and explains that the bot accepts mac.bid URLs or lot IDs
- FR-14: When a URL or lot ID is received, the bot immediately sends an "Analyzing..." message, then edits it with the result when analysis completes
- FR-15: When an already-analyzed item is sent, the bot returns the cached result with a "Re-analyze" inline keyboard button. Tapping "Re-analyze" re-runs analysis with force mode and edits the message with fresh results

## Non-Goals

- No proactive notifications when auctions close
- No webhook mode — polling only
- No multi-user support or user management
- No re-analysis trigger from Telegram (uses cached results; CLI `analyze --force` for re-analysis)
- No Telegram command for the `detail` view (the inline keyboard Full Details toggle covers this)
- No scheduled or automated analysis — all analysis is user-initiated via sending a link
- No web UI or TUI

## Edge Cases & Error Handling

- **Invalid URL or lot ID:** Bot replies with "I don't understand. Send a mac.bid URL or lot ID."
- **mac.bid API down:** Bot replies with a specific error: "Failed to fetch item from mac.bid. Try again later."
- **eBay API failure:** Analysis proceeds with AI-only estimate; response indicates source is "ai" not "blended"
- **Gemini API failure:** Analysis proceeds with eBay-only estimate; response indicates source is "ebay"
- **Both eBay and Gemini fail:** Item is stored with `needs_manual_review = true` and bot response indicates no pricing data available
- **Lot already closed at time of analysis:** Analysis still runs and stores result; item shows as closed in DB
- **`/active` with no open items:** Bot replies with "No active items. Send a mac.bid link to analyze one."
- **`/active` sync fails for some items:** Partial sync is acceptable; show what's available with a note about sync errors
- **Bot token invalid:** Process exits with clear error message on startup
- **Allowed user ID invalid or missing:** Process exits with clear error message on startup
- **Telegram API rate limits:** Telegraf handles retry logic internally
- **Message too long for Telegram:** Telegram has a 4096 character limit per message. If the full details view exceeds this, truncate AI reasoning/comparables with a "..." indicator

## Technical Considerations

- **Library:** Telegraf (npm package `telegraf`) for Telegram bot framework
- **Runtime:** Bun — verify Telegraf compatibility with Bun before starting
- **Process model:** Single entry point (`src/cli.ts`), `telegram` subcommand starts the long-running bot
- **Formatting:** Telegram HTML mode (`parse_mode: "HTML"`) — more reliable than Markdown for structured output
- **Inline keyboards:** Telegraf's `Markup.inlineKeyboard()` for the Full Details / Summary toggle
- **Callback queries:** Use callback data like `details:<lot_id>`, `summary:<lot_id>`, and `reanalyze:<lot_id>` to identify actions
- **Shared sync function:** Extract from the existing `live-update.ts` logic into a new module (e.g., `src/sync.ts`) before deleting the old file
- **Existing analysis pipeline:** `analyzeItem()` in `src/analyze.ts` is the core — no changes needed to the analysis logic itself
- **URL parsing:** Reuse existing logic that extracts auction ID and lot number from mac.bid URLs
- **Database:** No schema changes needed; existing `analyzed_items` table has all required fields

## Success Metrics

- Bot responds to a mac.bid URL with a formatted analysis in under 30 seconds
- `/active` command returns synced overview in under 15 seconds for up to 20 open items
- Full Details / Summary toggle responds in under 2 seconds
- Zero unhandled exceptions that crash the bot process
- All existing CLI commands (`analyze`, `results`, `detail`) continue to work after refactor

## Open Questions

None — all resolved.
