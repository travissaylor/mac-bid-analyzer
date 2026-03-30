# Configuration Reference

[← Back to Project](./PROJECT.md)

## Environment Variables (`.env`)

```bash
# eBay Browse API (https://developer.ebay.com)
EBAY_APP_ID=your-app-id
EBAY_APP_SECRET=your-app-secret

# OpenAI API (https://platform.openai.com)
OPENAI_API_KEY=your-openai-key

# Gemini API (https://ai.google.dev)
GEMINI_API_KEY=your-gemini-key

# Telegram Bot (https://core.telegram.org/bots)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ALLOWED_USER_ID=your-numeric-user-id
```

## Config File (`config.json`)

```json
{
  "home_building_ids": [15, 16, 6, 1],
  "discount_threshold": 0.30,
  "lot_fee": 3.00,
  "buyers_premium_rate": 0.15,
  "min_ebay_comps": 5,
  "location_tiers": {
    "transfer": {
      "extra_cost": 10
    },
    "remote": {
      "extra_cost": 25
    }
  },
  "manual_review_conditions": ["USED", "SALVAGE", "DAMAGED"],
  "llm_model": "gemini/gemini-3.1-flash-lite-preview"
}
```

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `home_building_ids` | number[] | `[15, 16, 6, 1]` | Building IDs for your local pickup locations. Transfer-eligible buildings are auto-derived from the `/buildings` API. |
| `discount_threshold` | number | `0.30` | Minimum discount off eBay median. 0.30 = must be at least 30% cheaper. |
| `lot_fee` | number | `3.00` | Flat fee per won item. |
| `buyers_premium_rate` | number | `0.15` | Buyer's premium as decimal (15%). |
| `min_ebay_comps` | number | `5` | Minimum eBay sold listings required for a confident recommendation. Below this, falls back to LLM advisory. |
| `location_tiers.transfer.extra_cost` | number | `10` | Cost added for items at transfer-eligible buildings. |
| `location_tiers.remote.extra_cost` | number | `25` | Cost added for items at non-transfer buildings. |
| `manual_review_conditions` | string[] | `["USED", "SALVAGE", "DAMAGED"]` | Conditions that skip auto-recommendation and flag for manual review. |
| `llm_model` | string | `"gemini/gemini-3.1-flash-lite-preview"` | LLM provider and model in `"provider/model-name"` format. Supported providers: `openai`, `gemini`. (Deprecated: `gemini_model` field is auto-converted to `llm_model` with `gemini/` prefix.) |

## CLI Flags

### `mac-bid analyze <input>`

| Flag | Description | Example |
|------|-------------|---------|
| `<input>` | Mac.bid URL or lot ID (required) | `https://mac.bid/auction/76563/lot/3194Q` or `52217488` |
| `--force` | Re-analyze even if already in DB | `mac-bid analyze 52217488 --force` |
| `--threshold <n>` | Override discount threshold for this run | `mac-bid analyze 52217488 --threshold 0.40` |
| `--model <p/m>` | Override LLM provider/model for this run | `mac-bid analyze 52217488 --model gemini/gemini-2.5-flash` |
| `--dry-run` | Run without writing to the database | `mac-bid analyze 52217488 --dry-run` |

### `mac-bid results`

| Flag | Description | Example |
|------|-------------|---------|
| `--open` | Show only open auctions | `mac-bid results --open` |
| `--deals` | Show only items with positive deal score | `mac-bid results --deals` |
| `--review` | Show only items needing manual review | `mac-bid results --review` |

### `mac-bid telegram`

Starts the Telegram bot in long-polling mode. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID` env vars.

Bot commands: `/active` (show open items with live sync), `/help`. Send a mac.bid URL or lot ID to analyze an item.

### `mac-bid eval export`

| Flag | Description | Example |
|------|-------------|---------|
| `--output <path>` | Output file path (default: `evals/fixtures.jsonl`) | `mac-bid eval export --output data/fixtures.jsonl` |

### `mac-bid eval run`

| Flag | Description | Example |
|------|-------------|---------|
| `--fixtures <path>` | Fixture file path (default: `evals/fixtures.jsonl`) | `mac-bid eval run --fixtures data/fixtures.jsonl` |
| `--models <m1,m2>` | Comma-separated models (required) | `mac-bid eval run --models gemini/gemini-2.5-flash,openai/gpt-4o-mini` |

## Input Format Support

The `analyze` command accepts these formats:

| Format | Example | Parsed as |
|--------|---------|-----------|
| Full URL | `https://mac.bid/auction/76563/lot/3194Q` | auction_id=76563, lot_number=3194Q |
| Full URL (www) | `https://www.mac.bid/auction/76563/lot/3194Q` | auction_id=76563, lot_number=3194Q |
| Lot permalink | `https://mac.bid/lot/52217488` | lot_id=52217488 |
| Bare lot ID | `52217488` | lot_id=52217488 |

## Prerequisites

- **Bun >= 1.0** — Install via `curl -fsSL https://bun.sh/install | bash`

## Setup

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install
cd /path/to/mac-bid-analyzer
bun install

# Configure
cp .env.example .env
# Edit .env with your credentials
# Edit config.json with your building IDs
```
