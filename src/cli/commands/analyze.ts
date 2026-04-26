import { parseLotId, resolveLotId, analyzeItem } from "../../analyze";
import { loadConfig } from "../../config";
import { clearBuildingsCache } from "../../location";
import { toTextSummary, resolveDisplayData } from "../../format";
import type { AnalyzeResult } from "../../shared/types";
import { log, parseArgs, timestamp } from "../index";

export function printAnalyzeHelp(): void {
  console.log(`${timestamp()} Usage: bun run src/main.ts analyze <url|lotId> [options]`);
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

export async function run(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (parsed.flags.help) {
    printAnalyzeHelp();
    return 0;
  }

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
    return 0;
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }
}
