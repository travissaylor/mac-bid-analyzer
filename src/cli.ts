import { openDatabase, getOpenItems, getAllItems, getDeals, getReviewItems, getItemByLotId } from "./db";
import type { AnalyzedItem } from "./db";
import { parseLotId, resolveLotId, analyzeItem, printAnalysisSummary } from "./analyze";
import { loadConfig } from "./config";
import { clearBuildingsCache } from "./location";

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
  console.log("  results              Query and display stored analysis results");
  console.log("  detail <lotId>       Show full AI analysis for a specific item");
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

function printDetailHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/cli.ts detail <lotId>`);
  console.log("");
  console.log("Show full AI analysis for a previously analyzed item.");
  console.log("Displays AI estimates, confidence, reasoning, comparable products,");
  console.log("and eBay data side-by-side.");
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
  subcommand: "analyze" | "results" | "detail" | "help";
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

  if (subcommand !== "analyze" && subcommand !== "results" && subcommand !== "detail") {
    throw new Error(`Unknown subcommand: ${subcommand}. Run with --help for usage.`);
  }

  const input = (subcommand === "analyze" || subcommand === "detail") ? positional[1] : undefined;

  if (subcommand === "analyze" && !flags.help && !input) {
    throw new Error("analyze requires an input (URL or lot ID). Run with --help for usage.");
  }

  if (subcommand === "detail" && !flags.help && !input) {
    throw new Error("detail requires a lot ID. Run with --help for usage.");
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

export function printItemDetail(item: AnalyzedItem): void {
  console.log(`--- Detail: Lot ${item.lot_id} ---`);
  console.log(`  Product:     ${item.product_name}`);
  console.log(`  Condition:   ${item.condition}`);
  console.log(`  Current Bid: $${item.current_bid.toFixed(2)}`);
  console.log(`  Status:      ${item.is_open ? "OPEN" : "CLOSED"}`);
  console.log(`  Location:    ${item.auction_location ?? "Unknown"} (${item.location_tier ?? "unknown"} tier, +$${item.location_cost.toFixed(2)})`);
  console.log(`  Analyzed:    ${item.analyzed_at}`);
  console.log(`  Source:      ${item.analysis_source}`);
  console.log("");

  // eBay section
  console.log("  --- eBay Data ---");
  if (item.ebay_sold_count > 0) {
    console.log(`  Median:      $${(item.ebay_sold_median ?? 0).toFixed(2)}`);
    console.log(`  Low:         $${(item.ebay_sold_low ?? 0).toFixed(2)}`);
    console.log(`  High:        $${(item.ebay_sold_high ?? 0).toFixed(2)}`);
    console.log(`  Comps:       ${item.ebay_sold_count}`);
    if (item.ebay_search_query) {
      console.log(`  Search:      ${item.ebay_search_query}`);
    }
  } else {
    console.log("  No eBay comps found.");
  }
  console.log("");

  // AI section
  console.log("  --- AI Analysis ---");
  if (item.llm_provider && item.llm_estimate_mid !== null) {
    console.log(`  Provider:    ${item.llm_provider}`);
    console.log(`  Low:         $${(item.llm_estimate_low ?? 0).toFixed(2)}`);
    console.log(`  Mid:         $${item.llm_estimate_mid.toFixed(2)}`);
    console.log(`  High:        $${(item.llm_estimate_high ?? 0).toFixed(2)}`);
    if (item.llm_confidence !== null) {
      console.log(`  Confidence:  ${item.llm_confidence}/100`);
    }
    if (item.llm_reasoning) {
      console.log(`  Reasoning:   ${item.llm_reasoning}`);
    }
    if (item.llm_comparables) {
      try {
        const comparables = JSON.parse(item.llm_comparables) as Array<{ name: string; estimatedPrice: number }>;
        if (comparables.length > 0) {
          console.log("  Comparables:");
          for (const comp of comparables) {
            console.log(`    - ${comp.name}: $${comp.estimatedPrice.toFixed(2)}`);
          }
        }
      } catch {
        // ignore malformed comparables JSON
      }
    }
  } else {
    console.log("  No AI analysis available for this item.");
  }
  console.log("");

  // Final recommendation
  console.log("  --- Recommendation ---");
  if (item.recommended_max_bid !== null) {
    console.log(`  Max Bid:     $${item.recommended_max_bid.toFixed(2)}`);
  } else {
    console.log(`  Max Bid:     N/A`);
  }
  if (item.deal_score !== null) {
    console.log(`  Deal Score:  ${item.deal_score.toFixed(0)}%`);
  }
  if (item.needs_manual_review) {
    console.log(`  Review:      ${item.manual_review_reason}`);
  }
}

async function runDetail(lotIdStr: string): Promise<void> {
  const lotId = Number(lotIdStr);
  if (isNaN(lotId) || lotId <= 0) {
    throw new Error(`Invalid lot ID: ${lotIdStr}`);
  }

  const db = openDatabase();
  try {
    const item = getItemByLotId(db, lotId);
    if (!item) {
      throw new Error(`No analysis found for lot ${lotId}. Run 'analyze ${lotId}' first.`);
    }
    printItemDetail(item);
  } finally {
    db.close();
  }
}

async function runResults(flags: ParsedCommand["flags"]): Promise<void> {
  const db = openDatabase();
  try {
    let items: AnalyzedItem[];

    if (flags.open) {
      items = getOpenItems(db);
      log(`Showing open auctions...`);
    } else if (flags.deals) {
      items = getDeals(db);
      log(`Showing deals (positive deal score, best first)...`);
    } else if (flags.review) {
      items = getReviewItems(db);
      log(`Showing items needing manual review...`);
    } else {
      items = getAllItems(db);
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
    } else if (parsed.subcommand === "results") {
      printResultsHelp();
    } else if (parsed.subcommand === "detail") {
      printDetailHelp();
    } else {
      printUsage();
    }
    process.exit(0);
  }

  if (parsed.subcommand === "analyze") {
    try {
      const parsedLot = parseLotId(parsed.input!);
      const config = loadConfig(args);
      clearBuildingsCache();

      const resolved = await resolveLotId(parsedLot);
      log(`Analyzing lot ${resolved.lotId}...`);
      const result = await analyzeItem(resolved.lotId, config, {
        force: parsed.flags.force,
        dryRun: parsed.flags.dryRun,
        ssrData: resolved.ssrData,
      });
      printAnalysisSummary(result);
      process.exit(0);
    } catch (err) {
      log(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (parsed.subcommand === "detail") {
    try {
      await runDetail(parsed.input!);
      process.exit(0);
    } catch (err) {
      log(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (parsed.subcommand === "results") {
    await runResults(parsed.flags);
    process.exit(0);
  }
}

if (import.meta.main) {
  main();
}
