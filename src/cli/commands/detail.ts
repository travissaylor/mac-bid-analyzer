import { openDatabase, getItemByLotId } from "../../db";
import { toTextDetail } from "../../format";
import { log, parseArgs, timestamp } from "../index";

export function printDetailHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/main.ts detail <lotId>`);
  console.log("");
  console.log("Show full AI analysis for a previously analyzed item.");
  console.log("Displays AI estimates, confidence, reasoning, comparable products,");
  console.log("and eBay data side-by-side.");
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

export async function run(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (parsed.flags.help) {
    printDetailHelp();
    return 0;
  }

  try {
    await runDetail(parsed.input!);
    return 0;
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }
}
