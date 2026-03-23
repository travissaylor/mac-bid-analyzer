# PRD: Mac Bid Analyzer

## Introduction

Mac.bid lists thousands of liquidation items daily at auction starting at $1, but there's no easy way to know what an item is actually worth on the secondary market before bidding. The Mac Bid Analyzer is a CLI tool that cross-references mac.bid auction items with eBay sold listings to calculate a recommended maximum bid, factoring in all fees, taxes, and location costs. It runs unattended via cron on a personal Linux server, pulling the user's mac.bid watchlist and storing results in SQLite for later review.

## Goals

- Determine secondary market value for any mac.bid auction item using eBay sold listings data
- Calculate a recommended maximum bid that guarantees at least 30% savings vs. secondary market, after all fees and taxes
- Automatically analyze all items on the user's mac.bid watchlist on a recurring schedule
- Skip already-analyzed items to minimize redundant API calls
- Keep live auction data (current bid, open/closed status) up to date for all tracked items
- Store all results in SQLite for querying and future TUI development
- Alert the user via push notification when the system is broken (circuit breaker)

## User Stories

### US-001: Project setup with Bun

**Description:** As a developer, I need the project initialized with Bun as its runtime so that all other work has a foundation to build on.

**Acceptance Criteria:**

- [ ] `package.json` specifies Bun as the runtime with `"bun": ">=1.0"` in engines
- [ ] `bun.lockb` is committed for reproducible installs
- [ ] `tsconfig.json` configured for Bun with strict mode
- [ ] `.env.example` committed with all required variables and inline comments:
  ```
  # Mac.bid credentials (Firebase auth)
  MACBID_EMAIL=
  MACBID_PASSWORD=

  # eBay Browse API (https://developer.ebay.com)
  EBAY_APP_ID=
  EBAY_APP_SECRET=

  # Gemini API (https://ai.google.dev)
  GEMINI_API_KEY=

  # Ntfy push notifications (self-hosted)
  NTFY_URL=http://localhost:2586/mac-bid-alerts
  ```
- [ ] `.gitignore` covers `.env`, `data.db`, `.firebase-token`, `node_modules`
- [ ] `README.md` documents setup steps: install Bun, `bun install`, copy `.env.example` to `.env`, configure `config.json`, set up cron
- [ ] Runs via `bun run src/cli.ts <subcommand>` — no build step needed
- [ ] Typecheck passes

### US-002: Configuration system

**Description:** As a mac.bid buyer, I want to configure pricing parameters and location preferences in a file so that I can tweak the tool's behavior without changing code.

**Acceptance Criteria:**

- [ ] Reads `config.json` from project root
- [ ] Loads `.env` for credentials using Bun's built-in env support
- [ ] Config file supports all fields documented in docs/CONFIGURATION.md
- [ ] CLI flags (`--force`, `--threshold`, `--dry-run`) override config file values
- [ ] If `config.json` is missing, uses sensible defaults (30% threshold, $3 lot fee, 15% premium, 5 min comps, etc.)
- [ ] Validates config on load and prints clear errors for invalid values
- [ ] Typecheck passes

### US-003: SQLite database setup and operations

**Description:** As a developer, I need a reliable data layer so that analysis results persist and can be queried by the future TUI.

**Acceptance Criteria:**

- [ ] Database file created at `data.db` in project root on first run
- [ ] Schema includes tables: `analyzed_items`, `error_log`, `circuit_breaker` (as defined in docs/SCHEMA.md)
- [ ] Indexes created on `is_open`, `auction_id`, `category`, `condition`, `deal_score`
- [ ] Provides functions for: insert/upsert analyzed item, query by lot ID, query open items, update live data, log errors, check/reset circuit breaker
- [ ] Uses `bun:sqlite` (built-in Bun SQLite driver)
- [ ] Typecheck passes

### US-004: CLI entrypoint with subcommands

**Description:** As a mac.bid buyer, I want a single CLI tool with clear subcommands so that I can run different operations easily.

**Acceptance Criteria:**

- [ ] Single entrypoint at `src/cli.ts` runnable via `bun run src/cli.ts <subcommand>`
- [ ] `analyze <input>` subcommand — runs single-item analysis
- [ ] `watchlist` subcommand — runs watchlist orchestration
- [ ] `results` subcommand — queries and displays DB results with flags: `--open`, `--deals`, `--review`
- [ ] `--help` flag shows usage for each subcommand
- [ ] Invalid input or unknown subcommand prints helpful error message
- [ ] All output includes timestamps for log compatibility
- [ ] Exit code 0 on success, non-zero on failure
- [ ] Typecheck passes

### US-005: eBay Browse API integration

**Description:** As a developer, I need to query eBay's Browse API for sold listings so that the tool can determine real secondary market prices.

**Acceptance Criteria:**

- [ ] Authenticates with eBay using client credentials OAuth flow (App ID + Secret from `.env`)
- [ ] Caches the eBay OAuth token until expiry
- [ ] Searches sold/completed listings by UPC using the Browse API `search` endpoint
- [ ] When UPC is detected as an Amazon ASIN, searches by product name instead
- [ ] Filters results by item condition matching the mac.bid condition where possible (open box, new, like new)
- [ ] Returns median, low, high sold prices and total comp count
- [ ] Returns the search query used (for debugging/display)
- [ ] Handles eBay API errors gracefully (logs error, returns null result, does not crash)
- [ ] Typecheck passes

### US-006: Determine location cost tier automatically

**Description:** As a developer, I need the tool to automatically derive which buildings are transfer-eligible from the user's home buildings so that location cost tiers stay accurate without manual config updates.

**Acceptance Criteria:**

- [ ] Reads `home_building_ids` from `config.json`
- [ ] Fetches `GET /buildings` from mac.bid API
- [ ] For each home building, parses its `transfer_destinations` field (comma-separated building IDs)
- [ ] Collects all unique transfer-destination building IDs into the "transfer" tier
- [ ] Items at home buildings get $0 extra cost
- [ ] Items at transfer-eligible buildings get $10 extra cost (configurable)
- [ ] Items at all other buildings get $25 extra cost (configurable)
- [ ] Building data can be cached for the duration of a run (does not change frequently)
- [ ] Typecheck passes

### US-007: Analyze a single item by URL or lot ID

**Description:** As a mac.bid buyer, I want to analyze a specific auction item so that I know its secondary market value and my recommended max bid before placing a bid.

**Acceptance Criteria:**

- [ ] CLI accepts a mac.bid URL in these formats: `https://mac.bid/auction/{id}/lot/{num}`, `https://www.mac.bid/auction/{id}/lot/{num}`, `https://mac.bid/lot/{id}`, or a bare numeric lot ID
- [ ] Fetches item data from mac.bid REST API (`GET /lot/:id` or `GET /auctions/:id?getItems=1`)
- [ ] Detects whether UPC is a real UPC or an Amazon ASIN (ASINs start with "B0" and are 10 chars)
- [ ] Searches eBay Browse API by UPC (or product name if ASIN) for sold/completed listings
- [ ] Calculates recommended max bid using the pricing formula if 5+ eBay comps found
- [ ] Falls back to Gemini LLM advisory estimate if fewer than 5 eBay comps
- [ ] Flags items with USED/SALVAGE/DAMAGED condition as "needs manual review" with no auto-recommendation
- [ ] Determines location cost tier (home=$0, transfer=$10, remote=$25) based on item's building
- [ ] Stores full analysis result in SQLite database
- [ ] Prints human-readable summary to stdout (product name, eBay median, recommended max bid, current bid, verdict)
- [ ] `--force` flag re-analyzes an item that already exists in the DB
- [ ] `--threshold` flag overrides the discount threshold for this run
- [ ] If item already exists in DB and `--force` not set, prints existing result and skips re-analysis
- [ ] Typecheck passes with `bun check` or equivalent

### US-008: Gemini LLM fallback for low-comp items

**Description:** As a mac.bid buyer, I want an estimated value even when eBay doesn't have enough sold data so that I have some reference point for uncommon items.

**Acceptance Criteria:**

- [ ] When eBay returns fewer than 5 sold comps, calls Gemini API with product details
- [ ] Sends product name, UPC, condition, retail price, category, and description
- [ ] Parses response as JSON with `low`, `mid`, `high` price estimates
- [ ] Stores estimates in DB as `llm_estimate_low`, `llm_estimate_mid`, `llm_estimate_high` with `llm_provider = "gemini"`
- [ ] Sets `analysis_source = "llm"` and `needs_manual_review = 1`
- [ ] Does NOT generate a `recommended_max_bid` — LLM estimates are advisory only
- [ ] Handles Gemini API errors gracefully (logs error, marks item as `analysis_source = "none"`)
- [ ] Typecheck passes

### US-009: Authenticate with mac.bid via Firebase

**Description:** As a mac.bid buyer, I want the tool to authenticate with my mac.bid account so that it can access my watchlist.

**Acceptance Criteria:**

- [ ] Signs in via Firebase Auth REST API using email/password from `.env`
- [ ] Caches the refresh token locally (e.g., `.firebase-token` file, gitignored)
- [ ] On subsequent runs, uses the cached refresh token to obtain a new ID token without re-entering credentials
- [ ] If refresh token is expired or invalid, falls back to full email/password sign-in
- [ ] ID token is passed as `Authorization` header on authenticated API calls
- [ ] Typecheck passes

### US-010: Pull and analyze watchlist items

**Description:** As a mac.bid buyer, I want to automatically analyze all items on my watchlist so that I don't have to manually run analysis on each one.

**Acceptance Criteria:**

- [ ] Authenticates with mac.bid and calls `GET /user/me` to retrieve `watchlist_full`
- [ ] For each item not already in the database, runs the single-item analysis (same logic as US-007)
- [ ] For items already analyzed, skips the eBay/LLM analysis
- [ ] `--force` flag re-analyzes all items regardless of existing DB entries
- [ ] `--dry-run` flag lists items that would be analyzed without running analysis
- [ ] Prints summary table to stdout after completion (total items, analyzed, skipped, errors)
- [ ] Typecheck passes

### US-011: Update live auction data for open items

**Description:** As a mac.bid buyer, I want the tool to refresh current bid and auction status for all open items so that my database always reflects recent auction state.

**Acceptance Criteria:**

- [ ] On each watchlist run, queries all items in DB where `is_open = 1`
- [ ] For each open item, calls `GET /map-bid/ddb/lot/:lotId` to get current bid, total bids, is_open, watchers_count
- [ ] Updates the corresponding fields in SQLite
- [ ] Recalculates `deal_score` based on updated `current_bid` and `recommended_max_bid`
- [ ] Updates `live_updated_at` timestamp
- [ ] If an item is now closed (`is_open = false`), marks it as closed in the DB
- [ ] Typecheck passes

### US-012: Circuit breaker with Ntfy alerts

**Description:** As a mac.bid buyer, I want to be alerted when the tool is consistently failing so that I can investigate and fix the problem.

**Acceptance Criteria:**

- [ ] Each error during a watchlist run is logged to the `error_log` table with error type, message, lot ID, and timestamp
- [ ] Tracks consecutive failures by error type in the `circuit_breaker` table
- [ ] When the same error type occurs 5 consecutive runs in a row, sends a push notification via Ntfy
- [ ] Ntfy notification includes the error type, count, and last error message
- [ ] After notification is sent, sets `notified = 1` to avoid repeat alerts
- [ ] When a run succeeds for that error type, resets the consecutive failure counter
- [ ] Ntfy URL is configurable via `NTFY_URL` in `.env`
- [ ] If Ntfy is unreachable, logs the alert failure but does not crash the run
- [ ] When circuit breaker trips (5 consecutive failures), halts the current batch and exits with non-zero code
- [ ] Typecheck passes

### US-013: Query results from database

**Description:** As a mac.bid buyer, I want to query my analysis results from the command line so that I can review deals before the TUI is built.

**Acceptance Criteria:**

- [ ] `mac-bid results` prints a table of all analyzed items (lot ID, product name, condition, eBay median, max bid, current bid, deal score, status)
- [ ] `--open` flag filters to only open auctions
- [ ] `--deals` flag filters to items with positive deal score (current bid < recommended max bid)
- [ ] `--review` flag filters to items needing manual review
- [ ] Results sorted by deal score descending by default
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The CLI must parse mac.bid URLs in four formats: full URL with auction/lot, full URL with www prefix, lot permalink (`/lot/{id}`), and bare numeric lot ID
- FR-2: The system must authenticate with mac.bid using Firebase Auth REST API (email/password sign-in) and cache the refresh token for subsequent runs
- FR-3: The system must fetch the user's watchlist via `GET /user/me` using the Firebase ID token as Authorization header
- FR-4: The system must search eBay Browse API sold listings by UPC, falling back to product name search when the UPC is detected as an Amazon ASIN (starts with "B0", 10 characters)
- FR-5: The system must require a minimum of 5 eBay sold comps before generating a recommended max bid
- FR-6: When fewer than 5 eBay comps are found, the system must call Gemini to get an advisory price estimate and flag the item for manual review
- FR-7: Items with condition USED, SALVAGE, or DAMAGED must be flagged as "needs manual review" regardless of eBay comp count, with no auto-generated max bid recommendation
- FR-8: The max bid formula must be: `(ebay_median * (1 - discount_threshold) - lot_fee - location_cost) / (1 + buyers_premium_rate + sales_tax_rate)`
- FR-9: Sales tax rate must be looked up dynamically from the `GET /buildings` endpoint based on the item's building ID
- FR-10: Location cost tiers must be derived automatically: home buildings from config ($0), transfer-eligible buildings derived from `/buildings` API transfer_destinations ($10), all others ($25)
- FR-11: Each watchlist run must update live auction data (current_bid, is_open, total_bids, watchers_count) for all items marked as open in the DB by calling `GET /map-bid/ddb/lot/:lotId`
- FR-12: Deal score must be calculated as `(recommended_max_bid - current_bid) / recommended_max_bid * 100` and updated whenever live data is refreshed
- FR-13: The system must track consecutive errors by type and trip a circuit breaker after 5 consecutive same-type failures across runs, sending a Ntfy push notification and halting the batch
- FR-14: The system must log all output with timestamps to stdout for cron log capture
- FR-15: The `--force` flag must cause re-analysis of items that already exist in the DB
- FR-16: Items with a max bid that calculates to zero or negative must be stored but flagged as "not worth it"
- FR-17: The eBay OAuth token must be cached until expiry to avoid redundant auth calls
- FR-18: The `/buildings` data must be cached for the duration of a single run

## Non-Goals

- No automated bidding — this tool recommends, the user bids manually on mac.bid
- No TUI in v1 — `results` subcommand is a simple table output; TUI is a future project
- No push notifications for good deals in v1 — only circuit breaker failure alerts via Ntfy
- No "closing soon" urgency alerts in v1
- No adding or removing items from the mac.bid watchlist — read-only access
- No web dashboard or browser UI
- No historical price tracking or trend analysis
- No scraping of any kind (eBay, Google Shopping, etc.) — API-only data sources
- No support for Typesense search or mac.bid's search index
- No automatic condition-based price adjustments for USED/SALVAGE/DAMAGED items — these are manual review only
- No multi-user support — single user, single config

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Mac.bid API returns 500 or is unreachable | Log error, skip item, continue with rest of watchlist. Increment circuit breaker counter. |
| Mac.bid API changes response shape (missing expected fields) | Log validation error with field name, skip item, continue. Increment circuit breaker. |
| eBay API returns 0 results | Fall back to Gemini LLM estimate. Flag as manual review. |
| eBay API returns 1-4 results | Fall back to Gemini LLM estimate (below 5-comp threshold). Flag as manual review. |
| eBay OAuth token expired mid-run | Re-authenticate automatically using client credentials, retry the request. |
| Firebase ID token expired mid-run | Use cached refresh token to obtain new ID token, retry the request. |
| Firebase refresh token expired | Fall back to full email/password sign-in. If that fails, halt with error. |
| Gemini API is unreachable or returns invalid JSON | Log error, store item with `analysis_source = "none"`, no estimate, flag for manual review. |
| UPC field contains Amazon ASIN (e.g., "B09JP9GFCC") | Detect by format (starts with "B0", 10 chars), search eBay by product name instead of UPC. |
| Max bid calculates to $0 or negative | Store result but set `needs_manual_review = 1` with reason "not worth it at this location." |
| Item's building_id not found in `/buildings` response | Default to remote tier ($25 extra cost). Log warning. |
| Lot ID from URL doesn't exist in mac.bid | Log "lot not found" error, skip. |
| Watchlist is empty | Print "No items on watchlist" and exit 0. |
| Database file doesn't exist on first run | Create it with full schema automatically. |
| `config.json` missing | Use hardcoded defaults, print info message. |
| `.env` missing required credentials | Print clear error message listing which vars are missing, exit 1. |
| Ntfy server unreachable when circuit breaker trips | Log the alert failure to stdout/file, still halt the batch with non-zero exit. |
| Same item appears on watchlist AND is passed to `analyze` directly | Treat lot_id as primary key; upsert behavior — `--force` re-analyzes, otherwise uses cached result. |
| 5 consecutive failures of the same error type | Trip circuit breaker: send Ntfy alert, halt current batch, exit non-zero. |
| Successful run after circuit breaker failures | Reset the consecutive failure counter for that error type, clear `notified` flag. |

## Technical Considerations

- **Runtime:** Bun (>=1.0) is a hard requirement — provides built-in TypeScript execution (no compile step), built-in SQLite (`bun:sqlite`), fast startup for cron. Install via `curl -fsSL https://bun.sh/install | bash`.
- **No build step:** Bun executes TypeScript directly. Cron runs `bun run src/cli.ts watchlist`.
- **Deployment:** Install Bun on the Linux server, clone the repo, `bun install`, configure `.env` and `config.json`, set up cron. No containers needed.
- **SQLite concurrency:** Only one process writes to the DB at a time (cron runs sequentially), so no WAL mode or locking concerns.
- **eBay Browse API:** Free tier allows 5,000 calls/day. Estimated usage is ~480/day worst case (48 cron runs × ~10 new items). Well within limits.
- **Firebase Auth REST API:** Well-documented Google service. Stable. Refresh tokens are long-lived (months). Endpoint: `identitytoolkit.googleapis.com`
- **Gemini free tier:** Sufficient for occasional fallback calls (items with <5 eBay comps)
- **Mac.bid API stability:** Undocumented internal APIs. Mitigation: validate response shapes, circuit breaker alerts, graceful per-item failure
- **Location mapping:** Items have `current_location_id` (location) and `building_id`. The `/locations` endpoint maps location IDs to building IDs. The `/buildings` endpoint has tax rates and transfer destinations. Cache both per run.

## Success Metrics

- Single-item analysis completes in under 10 seconds (fetch + eBay lookup + DB write)
- Watchlist run of 50 items completes in under 5 minutes
- Zero unhandled exceptions — every error is caught, logged, and counted
- Circuit breaker fires within 2.5 hours (5 × 30-min runs) of a persistent failure
- eBay API usage stays under 1,000 calls/day during normal operation
- Recommended max bids, when spot-checked against manual eBay research, are within 15% of what the user would calculate by hand

## Open Questions

- Should the `results` subcommand support CSV/JSON export for use with other tools?
- What's the exact lot fee for turbo/clock auctions — is it still $3.00 or different?
- Does mac.bid's buyer's premium rate (15%) vary by location or auction type, or is it universal?
- Should the tool detect and handle duplicate products across auctions (same UPC at multiple locations) by reusing the eBay analysis?
- When mac.bid lists quantity > 1 for a lot, does that affect the pricing calculation?
