# Mac Bid Analyzer

A CLI tool that analyzes mac.bid auction items to determine their secondary market value and recommend maximum bid prices. Cross-references eBay sold listings to find great deals.

## Problem

Mac.bid lists thousands of items daily at auction starting at $1. The challenge is knowing what an item is actually worth on the secondary market before you bid. Without that context, you either overbid (bad deal) or skip good deals because you didn't have time to research.

## Solution

CLI commands behind a single entrypoint:

1. **`mac-bid analyze <URL or lot ID>`** — Analyze a single item. Fetches product data from mac.bid, inspects product images for red flags, looks up sold comps on eBay, calculates a recommended max bid factoring in all fees/taxes/location costs, and stores the result in SQLite.

2. **`mac-bid results`** — Query the database. Shows analyzed items with filtering options.

3. **`mac-bid detail <lotId>`** — Show full AI analysis for a specific item.

4. **`mac-bid telegram`** — Start the Telegram bot for interactive analysis and live auction monitoring.

## Core Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  mac-bid analyze <url or lot ID>                            │
│      ├─ GET /map-bid/ddb/lot/:id → product data             │
│      ├─ SSR scrape www.mac.bid/lot/:id → images + metadata  │
│      ├─ LLM image analysis → detect damage/missing/mismatch │
│      ├─ LLM → optimized eBay search query                   │
│      ├─ eBay Browse API → sold comps (cascade search)        │
│      ├─ LLM → price estimate (with confidence + reasoning)   │
│      ├─ Calculate max bid (fees + tax + location)            │
│      └─ Store analysis in SQLite                             │
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
| Runtime | Bun | Built-in TypeScript, built-in SQLite, fast startup |
| Language | TypeScript | Developer's primary language |
| Database | SQLite (bun:sqlite) | Zero-dependency, single file, perfect for local CLI |
| Price data | eBay Browse API (free tier) | Sold listings = real market data, cascade search |
| LLM | OpenAI / Gemini (configurable) | Price estimation, image analysis, search query generation |
| Telegram | Telegraf | Interactive bot for analysis and live auction monitoring |

## Project Structure

```
mac-bid-analyzer/
├── src/
│   ├── cli.ts                # CLI entrypoint with subcommands
│   ├── analyze.ts            # Single item analysis logic
│   ├── config.ts             # Config file loader + CLI flag merging
│   ├── db.ts                 # SQLite schema and operations
│   ├── ebay.ts               # eBay Browse API client (cascade search)
│   ├── format.ts             # Display formatting (text/HTML for CLI and Telegram)
│   ├── location.ts           # Location/building classification
│   ├── sync.ts               # Live bid/status syncing for open items
│   ├── telegram.ts           # Telegram bot (long-polling)
│   ├── llm/
│   │   ├── index.ts          # Provider abstraction and factory
│   │   ├── gemini.ts         # Gemini provider (@google/genai)
│   │   ├── openai.ts         # OpenAI provider
│   │   ├── prompt.ts         # Price estimation system prompt
│   │   ├── image-prompt.ts   # Image analysis prompt and risk scoring
│   │   ├── search-query.ts   # eBay search query generation via LLM
│   │   └── fetch-image.ts    # Image URL → base64 fetcher
├── docs/
│   ├── PROJECT.md            # This file
│   ├── MACBID-API.md         # Mac.bid API reference
│   ├── PRICING.md            # Fee breakdown and bid formula
│   ├── SCHEMA.md             # SQLite schema documentation
│   ├── LLM-PROMPTS.md        # LLM prompts (estimation, image analysis, search query)
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
| eBay search strategy | 4-step cascade: UPC → LLM query → broadened LLM query → relaxed filters | Maximizes comp coverage while tracking search confidence |
| Condition handling | Auto-recommend for NEW/LIKE NEW/OPEN BOX; flag USED/SALVAGE/DAMAGED as manual review | Avoid bad recommendations on ambiguous conditions |
| Image analysis | LLM inspects product photos for damage, missing parts, mismatches | Red flags reduce confidence and may trigger manual review |
| Re-analysis policy | Never re-run (secondary market prices are stable); `--force` flag to override | Minimize API calls, respect rate limits |
| Location filtering | Never skip items; apply cost tiers ($0/$10/$25) | Every item is a candidate if the deal is good enough |
| Transfer buildings | Auto-derived from mac.bid /buildings API | Self-healing when transfer routes change |
| Typesense | Not used | All entry points are specific URLs; no search needed |

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
- **[LLM-PROMPTS.md](./LLM-PROMPTS.md)** — LLM prompts for price estimation, image analysis, and search query generation
- **[CONFIGURATION.md](./CONFIGURATION.md)** — Config file format, env vars, CLI flags
