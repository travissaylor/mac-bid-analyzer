# Mac Bid Analyzer

CLI tool that cross-references mac.bid auction items with eBay sold listings to calculate a recommended maximum bid, factoring in all fees, taxes, and location costs.

## Setup

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Configure pricing parameters

Create `config.json` with your location and pricing settings. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for details.

### 5. Set up cron (optional)

Run the watchlist analyzer every 30 minutes:

```bash
crontab -e
# Add: */30 * * * * cd /path/to/mac-bid-analyzer && bun run src/cli.ts watchlist >> /var/log/mac-bid.log 2>&1
```

## Usage

```bash
# Analyze a single item
bun run src/cli.ts analyze <url or lot ID>

# Analyze all watchlist items
bun run src/cli.ts watchlist

# Query results
bun run src/cli.ts results
```
