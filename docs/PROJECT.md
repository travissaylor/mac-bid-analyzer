# Mac Bid Analyzer

A CLI tool that analyzes mac.bid auction items to determine their secondary market value and recommend maximum bid prices. Runs on a personal Ubuntu server via cron, pulling your mac.bid watchlist and cross-referencing eBay sold listings to find great deals.

## Problem

Mac.bid lists thousands of items daily at auction starting at $1. The challenge is knowing what an item is actually worth on the secondary market before you bid. Without that context, you either overbid (bad deal) or skip good deals because you didn't have time to research.

## Solution

Two scripts behind a single CLI entrypoint:

1. **`mac-bid analyze <URL or lot ID>`** — Analyze a single item. Fetches product data from mac.bid, looks up sold comps on eBay, calculates a recommended max bid factoring in all fees/taxes/location costs, and stores the result in SQLite.

2. **`mac-bid watchlist`** — Orchestration layer. Authenticates with mac.bid via Firebase, pulls your watchlist, runs the single-item analysis on any unanalyzed items, and updates live auction data (current bid, is_open) on all open items.

3. **`mac-bid results`** — Query the database. Basic output for v1, future TUI planned.

## Core Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  Cron (every 30 min)                                        │
│  └─ mac-bid watchlist                                       │
│      ├─ Firebase auth → GET /user/me → watchlist_full       │
│      ├─ For each unanalyzed item:                           │
│      │   ├─ eBay Browse API → sold comps by UPC             │
│      │   ├─ Calculate max bid (fees + tax + location)       │
│      │   └─ Store analysis in SQLite                        │
│      └─ For each open item (already analyzed):              │
│          ├─ GET /map-bid/ddb/lot/:id → current bid, status  │
│          └─ Update SQLite with live data                    │
└─────────────────────────────────────────────────────────────┘
```

## Max Bid Formula

```
max_bid = (ebay_sold_median * 0.70 - lot_fee - location_cost) / (1 + buyers_premium_rate + sales_tax_rate)
```

Where:
- `ebay_sold_median` — Median sold price from eBay (minimum 5 comps required)
- `0.70` — Target 30% discount off secondary market value
- `lot_fee` — $3.00 flat per item
- `buyers_premium_rate` — 15% of winning bid
- `sales_tax_rate` — Varies by building (charged on bid price only)
- `location_cost` — $0 (home), $10 (transfer), $25 (remote)

See [PRICING.md](./PRICING.md) for full details.

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Built-in TypeScript, built-in SQLite, fast startup for cron |
| Language | TypeScript | Developer's primary language |
| Database | SQLite (bun:sqlite) | Zero-dependency, single file, perfect for local CLI |
| Mac.bid auth | Firebase Auth REST API | Stable Google service, email/password flow |
| Price data | eBay Browse API (free tier) | Sold listings = real market data, UPC search |
| LLM fallback | Gemini (free tier) | Advisory estimates when <5 eBay comps |
| Notifications | Ntfy (self-hosted) | Circuit breaker alerts, free, self-hosted |

## Project Structure

```
mac-bid-analyzer/
├── src/
│   ├── cli.ts                # CLI entrypoint with subcommands
│   ├── analyze-item.ts       # Single item analysis logic
│   ├── analyze-watchlist.ts  # Watchlist orchestrator
│   ├── lib/
│   │   ├── macbid.ts         # Mac.bid REST API client
│   │   ├── ebay.ts           # eBay Browse API client
│   │   ├── firebase-auth.ts  # Firebase auth for watchlist access
│   │   ├── gemini.ts         # Gemini LLM fallback client
│   │   ├── pricing.ts        # Max bid calculation logic
│   │   ├── db.ts             # SQLite schema and operations
│   │   ├── notifications.ts  # Ntfy client for alerts
│   │   └── errors.ts         # Circuit breaker / error tracking
│   └── config.ts             # Config file loader + CLI flag merging
├── docs/
│   ├── PROJECT.md            # This file
│   ├── MACBID-API.md         # Mac.bid API reference
│   ├── PRICING.md            # Fee breakdown and bid formula
│   ├── SCHEMA.md             # SQLite schema documentation
│   ├── LLM-PROMPTS.md        # Prompts for manual review items
│   └── CONFIGURATION.md      # Config file and env var reference
├── config.json               # User preferences
├── .env                      # Credentials (gitignored)
├── .env.example              # Template for required env vars
├── data.db                   # SQLite database (gitignored)
├── package.json              # Bun >= 1.0 required in engines
├── bun.lockb                 # Bun lockfile (committed)
├── tsconfig.json
└── .gitignore
```

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Watchlist source | Mac.bid's real watchlist via Firebase auth | Single source of truth, no manual sync |
| eBay search strategy | UPC first, product name fallback for ASINs | Exact matches, zero noise |
| Condition handling | Auto-recommend for NEW/LIKE NEW/OPEN BOX; flag USED/SALVAGE/DAMAGED as manual review | Avoid bad recommendations on ambiguous conditions |
| Re-analysis policy | Never re-run (secondary market prices are stable); `--force` flag to override | Minimize API calls, respect rate limits |
| Live data updates | Cron updates current_bid/is_open each run for open items | TUI stays a pure DB reader, no network needed |
| Location filtering | Never skip items; apply cost tiers ($0/$10/$25) | Every item is a candidate if the deal is good enough |
| Transfer buildings | Auto-derived from mac.bid /buildings API | Self-healing when transfer routes change |
| Error handling | Fail per-item, circuit breaker at 5 consecutive same-error failures | Resilient cron job that self-reports when broken |
| Typesense | Not used | All entry points are specific URLs or watchlist; no search needed |

## Input Formats

The `analyze` command accepts:

| Format | Example |
|--------|---------|
| Full URL | `https://mac.bid/auction/76563/lot/3194Q` |
| Full URL (www) | `https://www.mac.bid/auction/76563/lot/3194Q` |
| Lot permalink | `https://mac.bid/lot/52217488` |
| Bare lot ID | `52217488` |

## Supporting Documentation

- **[MACBID-API.md](./MACBID-API.md)** — Endpoints, response shapes, auth details
- **[PRICING.md](./PRICING.md)** — Fee structure, tax rules, bid formula with examples
- **[SCHEMA.md](./SCHEMA.md)** — SQLite table definitions and query patterns
- **[LLM-PROMPTS.md](./LLM-PROMPTS.md)** — Prompts for Gemini fallback and manual condition review
- **[CONFIGURATION.md](./CONFIGURATION.md)** — Config file format, env vars, CLI flags
