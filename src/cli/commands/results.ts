import { openDatabase, getOpenItems, getAllItems, getDeals, getReviewItems } from "../../db";
import { syncLiveData } from "../../sync";
import { resolveDisplayData, plainText } from "../../format";
import type { AnalyzedItem } from "../../shared/types";
import { log, parseArgs, timestamp, type ParsedCommand } from "../index";

export function printResultsHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/main.ts results [options]`);
  console.log("");
  console.log("Query and display stored analysis results.");
  console.log("");
  console.log("Options:");
  console.log("  --open               Show only open (active) auctions");
  console.log("  --deals              Show items with positive deal scores, sorted best first");
  console.log("  --review             Show items flagged for manual review");
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

export async function run(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (parsed.flags.help) {
    printResultsHelp();
    return 0;
  }

  try {
    await runResults(parsed.flags);
    return 0;
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }
}
