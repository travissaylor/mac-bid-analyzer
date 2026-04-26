import { openDatabase, getOpenItems, getAllItems, getDeals, getReviewItems, getItemByLotId } from "./db";
import type { AnalyzedItem } from "./db";
import { parseLotId, resolveLotId, analyzeItem } from "./analyze";
import type { AnalyzeResult } from "./analyze";
import { loadConfig } from "./config";
import { clearBuildingsCache } from "./location";
import { syncLiveData } from "./sync";
import { startTelegramBot } from "./telegram";
import { startServer } from "./server";
import { toTextSummary, toTextDetail, resolveDisplayData, plainText } from "./format";

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
  console.log("  telegram             Start the Telegram bot in long-polling mode");
  console.log("  server               Start the HTTP API server");
  console.log("");
  console.log("Global options:");
  console.log("  --help               Show help for a subcommand");
  console.log("  --force              Re-analyze items that already exist in the DB");
  console.log("  --threshold <0-1>    Override discount threshold (e.g. 0.3)");
  console.log("  --model <p/m>        Override LLM provider/model (e.g. gemini/gemini-2.5-flash)");
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
  console.log("  --model <p/m>        Override LLM provider/model (e.g. gemini/gemini-2.5-flash)");
  console.log("  --dry-run            Run without writing to the database");
  console.log(`  --feedback "text"    Set user feedback for this item (implies --force).`);
  console.log(`                       Pass an empty string ("") to clear existing feedback.`);
  console.log("                       Omit the flag entirely to preserve existing feedback.");
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
  subcommand: "analyze" | "results" | "detail" | "telegram" | "server" | "help";
  input?: string;
  flags: {
    help: boolean;
    force: boolean;
    dryRun: boolean;
    threshold?: number;
    open: boolean;
    deals: boolean;
    review: boolean;
    /**
     * Three-state semantics:
     *   undefined — flag not provided (preserve existing persisted feedback)
     *   null      — flag provided with empty/whitespace value (clear feedback)
     *   string    — flag provided with non-empty value (set feedback)
     */
    userFeedback?: string | null;
    /**
     * True when the --feedback flag was present in argv (regardless of value).
     * Presence implies force at the call site.
     */
    feedbackProvided: boolean;
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
    userFeedback: undefined as string | null | undefined,
    feedbackProvided: false,
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
    } else if (arg === "--model") {
      // Consumed by parseCliOverrides in config.ts, skip the value
      i++;
    } else if (arg === "--feedback") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error('--feedback requires a value (use "" to clear existing feedback)');
      }
      flags.feedbackProvided = true;
      flags.userFeedback = next.trim() === "" ? null : next;
      i++;
    } else if (arg.startsWith("--feedback=")) {
      const value = arg.slice("--feedback=".length);
      flags.feedbackProvided = true;
      flags.userFeedback = value.trim() === "" ? null : value;
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

  if (subcommand !== "analyze" && subcommand !== "results" && subcommand !== "detail" && subcommand !== "telegram" && subcommand !== "server") {
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

  const displayItems = items.map(resolveDisplayData);
  console.log(plainText.table!(displayItems));
  log(`${items.length} result(s) displayed.`);
}

export function printAnalysisSummary(result: AnalyzeResult): void {
  const { item, skipped } = result;

  if (skipped) {
    log("--- Existing Analysis ---");
  } else {
    log("--- Analysis Complete ---");
  }

  console.log(toTextSummary(item));

  const data = resolveDisplayData(item);
  if (data.manualReview) {
    // Already printed in summary
  } else if (data.isDeal) {
    console.log("✓ GOOD DEAL — current bid is below max bid");
  } else if (data.isOverMax) {
    console.log("✗ PASS — current bid exceeds max bid");
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
    console.log(toTextDetail(item));
  } finally {
    db.close();
  }
}

async function runResults(flags: ParsedCommand["flags"]): Promise<void> {
  const db = openDatabase();
  try {
    await syncLiveData(db);

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
        force: parsed.flags.force || parsed.flags.feedbackProvided,
        dryRun: parsed.flags.dryRun,
        ssrData: resolved.ssrData,
        userFeedback: parsed.flags.userFeedback,
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

  if (parsed.subcommand === "telegram") {
    startTelegramBot();
    return; // bot runs until killed
  }

  if (parsed.subcommand === "server") {
    startServer();
    return; // server runs until killed
  }

  if (parsed.subcommand === "results") {
    await runResults(parsed.flags);
    process.exit(0);
  }
}

if (import.meta.main) {
  main();
}
