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

## Usage

```bash
# Analyze a single item
bun run src/cli.ts analyze <url or lot ID>

# Query results
bun run src/cli.ts results

# Show full detail for an item
bun run src/cli.ts detail <lotId>
```

## Deploying

The Telegram bot runs on a persona server as a system service.

To deploy changes:

```bash
git pull origin main
sudo systemctl restart mac-bid-telegram
```

To check status and logs:

```bash
sudo systemctl status mac-bid-telegram
sudo journalctl -u mac-bid-telegram -f
```
