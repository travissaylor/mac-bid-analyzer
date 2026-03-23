import { openDatabase, getOpenItems } from "./db";
import type { AnalyzedItem } from "./db";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

function printUsage(): void {
  console.log(`${timestamp()} mac-bid-analyzer — Cross-reference mac.bid items with eBay sold listings`);
  console.log("");
  console.log("Usage: bun run src/cli.ts <subcommand> [options]");
  console.log("");
  console.log("Subcommands:");
  console.log("  analyze <url|lotId>  Analyze a single mac.bid item");
  console.log("  watchlist            Analyze all items on your mac.bid watchlist");
  console.log("  results              Query and display stored analysis results");
  console.log("");
  console.log("Global options:");
  console.log("  --help               Show help for a subcommand");
  console.log("  --force              Re-analyze items that already exist in the DB");
  console.log("  --threshold <0-1>    Override discount threshold (e.g. 0.3)");
  console.log("  --dry-run            Run without writing to the database");
}

function printAnalyzeHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/cli.ts analyze <url|lotId> [options]`);
  console.log("");
  console.log("Analyze a single mac.bid item by URL or lot ID.");
  console.log("");
  console.log("Input formats:");
  console.log("  https://mac.bid/auction/XYZ/lot/12345");
  console.log("  https://www.mac.bid/auction/XYZ/lot/12345");
  console.log("  /lot/12345");
  console.log("  12345");
  console.log("");
  console.log("Options:");
  console.log("  --force              Re-analyze even if item exists in DB");
  console.log("  --threshold <0-1>    Override discount threshold");
  console.log("  --dry-run            Run without writing to the database");
}

function printWatchlistHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/cli.ts watchlist [options]`);
  console.log("");
  console.log("Fetch and analyze all items on your mac.bid watchlist.");
  console.log("Skips items already analyzed unless --force is used.");
  console.log("");
  console.log("Options:");
  console.log("  --force              Re-analyze all items");
  console.log("  --threshold <0-1>    Override discount threshold");
  console.log("  --dry-run            Run without writing to the database");
}

function printResultsHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/cli.ts results [options]`);
  console.log("");
  console.log("Query and display stored analysis results.");
  console.log("");
  console.log("Options:");
  console.log("  --open               Show only open (active) auctions");
  console.log("  --deals              Show items with positive deal scores, sorted best first");
  console.log("  --review             Show items flagged for manual review");
}

export interface ParsedCommand {
  subcommand: "analyze" | "watchlist" | "results" | "help";
  input?: string;
  flags: {
    help: boolean;
    force: boolean;
    dryRun: boolean;
    threshold?: number;
    open: boolean;
    deals: boolean;
    review: boolean;
  };
}

export function parseArgs(args: string[]): ParsedCommand {
  const flags = {
    help: false,
    force: false,
    dryRun: false,
    threshold: undefined as number | undefined,
    open: false,
    deals: false,
    review: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--threshold") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--threshold requires a numeric value");
      }
      const val = Number(next);
      if (isNaN(val) || val <= 0 || val >= 1) {
        throw new Error("--threshold must be a number between 0 and 1 (exclusive)");
      }
      flags.threshold = val;
      i++;
    } else if (arg === "--open") {
      flags.open = true;
    } else if (arg === "--deals") {
      flags.deals = true;
    } else if (arg === "--review") {
      flags.review = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const subcommand = positional[0];

  if (!subcommand || flags.help && !subcommand) {
    return { subcommand: "help", flags };
  }

  if (subcommand !== "analyze" && subcommand !== "watchlist" && subcommand !== "results") {
    throw new Error(`Unknown subcommand: ${subcommand}. Run with --help for usage.`);
  }

  const input = subcommand === "analyze" ? positional[1] : undefined;

  if (subcommand === "analyze" && !flags.help && !input) {
    throw new Error("analyze requires an input (URL or lot ID). Run with --help for usage.");
  }

  return { subcommand, input, flags };
}

function formatResultsTable(items: AnalyzedItem[]): void {
  if (items.length === 0) {
    log("No results found.");
    return;
  }

  const header = [
    "Lot ID".padEnd(10),
    "Product Name".padEnd(40),
    "Condition".padEnd(10),
    "Bid".padEnd(8),
    "Max Bid".padEnd(10),
    "Score".padEnd(8),
    "Status".padEnd(8),
  ].join(" ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const item of items) {
    const status = item.is_open ? "OPEN" : "CLOSED";
    const maxBid = item.recommended_max_bid !== null ? `$${item.recommended_max_bid.toFixed(2)}` : "N/A";
    const score = item.deal_score !== null ? `${item.deal_score.toFixed(0)}%` : "N/A";
    const review = item.needs_manual_review ? " [REVIEW]" : "";

    console.log([
      String(item.lot_id).padEnd(10),
      (item.product_name.length > 38 ? item.product_name.slice(0, 37) + "…" : item.product_name).padEnd(40),
      item.condition.padEnd(10),
      `$${item.current_bid.toFixed(2)}`.padEnd(8),
      maxBid.padEnd(10),
      score.padEnd(8),
      (status + review).padEnd(8),
    ].join(" "));
  }

  log(`${items.length} result(s) displayed.`);
}

async function runResults(flags: ParsedCommand["flags"]): Promise<void> {
  const db = openDatabase();
  try {
    let items: AnalyzedItem[];

    if (flags.open) {
      items = getOpenItems(db);
      log(`Showing open auctions...`);
    } else if (flags.deals) {
      const allOpen = getOpenItems(db);
      items = allOpen
        .filter((i) => i.deal_score !== null && i.deal_score > 0)
        .sort((a, b) => (b.deal_score ?? 0) - (a.deal_score ?? 0));
      log(`Showing deals (positive deal score, best first)...`);
    } else if (flags.review) {
      const stmt = db.prepare("SELECT * FROM analyzed_items WHERE needs_manual_review = 1");
      items = stmt.all() as AnalyzedItem[];
      log(`Showing items needing manual review...`);
    } else {
      const stmt = db.prepare("SELECT * FROM analyzed_items ORDER BY analyzed_at DESC");
      items = stmt.all() as AnalyzedItem[];
      log(`Showing all results...`);
    }

    formatResultsTable(items);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  if (parsed.subcommand === "help" || parsed.flags.help) {
    if (parsed.subcommand === "analyze") {
      printAnalyzeHelp();
    } else if (parsed.subcommand === "watchlist") {
      printWatchlistHelp();
    } else if (parsed.subcommand === "results") {
      printResultsHelp();
    } else {
      printUsage();
    }
    process.exit(0);
  }

  if (parsed.subcommand === "analyze") {
    log(`Analyzing item: ${parsed.input}`);
    log("Error: analyze subcommand not yet implemented.");
    process.exit(1);
  }

  if (parsed.subcommand === "watchlist") {
    log("Running watchlist analysis...");
    log("Error: watchlist subcommand not yet implemented.");
    process.exit(1);
  }

  if (parsed.subcommand === "results") {
    await runResults(parsed.flags);
    process.exit(0);
  }
}

if (import.meta.main) {
  main();
}
