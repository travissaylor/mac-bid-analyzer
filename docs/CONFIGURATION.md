# Configuration Reference

[← Back to Project](./PROJECT.md)

## Environment Variables (`.env`)

```bash
# Mac.bid credentials (Firebase auth)
MACBID_EMAIL=your@email.com
MACBID_PASSWORD=yourpassword

# eBay Browse API
EBAY_APP_ID=your-app-id
EBAY_APP_SECRET=your-app-secret

# Gemini (LLM fallback - free tier)
GEMINI_API_KEY=your-gemini-key

# Ntfy (self-hosted, circuit breaker alerts)
NTFY_URL=http://localhost:2586/mac-bid-alerts
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
  "circuit_breaker_threshold": 5
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
| `circuit_breaker_threshold` | number | `5` | Number of consecutive same-error failures before alerting via Ntfy and halting. |

## CLI Flags

### `mac-bid analyze <input>`

| Flag | Description | Example |
|------|-------------|---------|
| `<input>` | Mac.bid URL or lot ID (required) | `https://mac.bid/auction/76563/lot/3194Q` or `52217488` |
| `--force` | Re-analyze even if already in DB | `mac-bid analyze 52217488 --force` |
| `--threshold <n>` | Override discount threshold for this run | `mac-bid analyze 52217488 --threshold 0.40` |

### `mac-bid watchlist`

| Flag | Description | Example |
|------|-------------|---------|
| `--force` | Re-analyze all items, not just new ones | `mac-bid watchlist --force` |
| `--dry-run` | Show what would be analyzed without doing it | `mac-bid watchlist --dry-run` |

### `mac-bid results`

| Flag | Description | Example |
|------|-------------|---------|
| `--open` | Show only open auctions | `mac-bid results --open` |
| `--deals` | Show only items with positive deal score | `mac-bid results --deals` |
| `--review` | Show only items needing manual review | `mac-bid results --review` |

## Input Format Support

The `analyze` command accepts these formats:

| Format | Example | Parsed as |
|--------|---------|-----------|
| Full URL | `https://mac.bid/auction/76563/lot/3194Q` | auction_id=76563, lot_number=3194Q |
| Full URL (www) | `https://www.mac.bid/auction/76563/lot/3194Q` | auction_id=76563, lot_number=3194Q |
| Lot permalink | `https://mac.bid/lot/52217488` | lot_id=52217488 |
| Bare lot ID | `52217488` | lot_id=52217488 |

## Cron Setup

```bash
# Run watchlist analysis every 30 minutes
*/30 * * * * cd /path/to/mac-bid-analyzer && bun run src/cli.ts watchlist >> /var/log/mac-bid-analyzer.log 2>&1
```

## Firebase Token Caching

The Firebase refresh token is cached to avoid re-authenticating on every run. Stored in a local file (e.g., `.firebase-token`) that is gitignored. The token refresh flow:

1. On first run: sign in with email/password, save refresh token
2. On subsequent runs: use refresh token to get a new ID token (~1 second, no password needed)
3. If refresh token expires (rare): fall back to full email/password sign-in
