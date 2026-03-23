import type { AppConfig } from "./config";
import { analyzeItem } from "./analyze";
import { getFirebaseIdToken } from "./firebase-auth";
import { openDatabase, getItemByLotId } from "./db";
import { clearBuildingsCache } from "./location";
import { updateOpenItems } from "./live-update";
import {
  trackError,
  resetOnSuccess,
  checkAndNotifyBreakers,
  CircuitBreakerTripped,
} from "./circuit-breaker";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

const MACBID_USER_URL = "https://api.macdiscount.com/map-bid/user/me";

export interface WatchlistItem {
  id: number;
  product_name?: string;
}

export interface WatchlistSummary {
  total: number;
  analyzed: number;
  skipped: number;
  errors: number;
  liveUpdated: number;
  liveClosed: number;
  liveErrors: number;
  circuitBreakerTripped: boolean;
}

export async function fetchWatchlist(idToken: string): Promise<WatchlistItem[]> {
  const response = await fetch(MACBID_USER_URL, {
    headers: {
      Authorization: idToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch watchlist: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from /user/me");
  }

  const watchlistFull = (data as Record<string, unknown>).watchlist_full;

  if (!Array.isArray(watchlistFull)) {
    throw new Error("watchlist_full is missing or not an array in /user/me response");
  }

  return watchlistFull.map((item: Record<string, unknown>) => ({
    id: item.id as number,
    product_name: (item.product_name ?? item.name ?? undefined) as string | undefined,
  }));
}

export async function runWatchlist(
  config: AppConfig,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<WatchlistSummary> {
  // Authenticate
  log("Authenticating with mac.bid...");
  const idToken = await getFirebaseIdToken(
    config.env.macbidEmail,
    config.env.macbidPassword
  );

  // Fetch watchlist
  log("Fetching watchlist...");
  const watchlistItems = await fetchWatchlist(idToken);
  log(`Found ${watchlistItems.length} item(s) on watchlist.`);

  if (watchlistItems.length === 0) {
    return { total: 0, analyzed: 0, skipped: 0, errors: 0, liveUpdated: 0, liveClosed: 0, liveErrors: 0, circuitBreakerTripped: false };
  }

  // Determine which items need analysis
  const db = openDatabase();
  let toAnalyze: WatchlistItem[];
  let skippedCount: number;

  try {
    if (options.force) {
      toAnalyze = watchlistItems;
      skippedCount = 0;
    } else {
      toAnalyze = [];
      skippedCount = 0;
      for (const item of watchlistItems) {
        const existing = getItemByLotId(db, item.id);
        if (existing) {
          skippedCount++;
        } else {
          toAnalyze.push(item);
        }
      }
    }
  } finally {
    db.close();
  }

  if (options.dryRun) {
    log("--- Dry Run ---");
    log(`Would analyze ${toAnalyze.length} item(s):`);
    for (const item of toAnalyze) {
      log(`  Lot ${item.id}${item.product_name ? ` — ${item.product_name}` : ""}`);
    }
    log(`Would skip ${skippedCount} already-analyzed item(s).`);
    return { total: watchlistItems.length, analyzed: 0, skipped: skippedCount, errors: 0, liveUpdated: 0, liveClosed: 0, liveErrors: 0, circuitBreakerTripped: false };
  }

  // Clear buildings cache once per run
  clearBuildingsCache();

  // Analyze items with circuit breaker tracking
  let analyzedCount = 0;
  let errorCount = 0;
  const cbDb = openDatabase();
  let circuitBreakerTripped = false;

  try {
    for (const item of toAnalyze) {
      try {
        log(`[${analyzedCount + errorCount + 1}/${toAnalyze.length}] Analyzing lot ${item.id}...`);
        await analyzeItem(item.id, config, { force: options.force, dryRun: false });
        analyzedCount++;

        // Reset circuit breaker for lot fetch errors on success
        resetOnSuccess(cbDb, "macbid_lot_fetch");
      } catch (err) {
        errorCount++;
        const error = err as Error;
        log(`Error analyzing lot ${item.id}: ${error.message}`);

        // Track error and check circuit breaker
        trackError(cbDb, error, item.id, config.circuit_breaker_threshold);

        try {
          await checkAndNotifyBreakers(cbDb, config.circuit_breaker_threshold, config.env.ntfyUrl);
        } catch (cbErr) {
          if (cbErr instanceof CircuitBreakerTripped) {
            log(`Circuit breaker tripped: ${cbErr.errorType} — halting batch.`);
            circuitBreakerTripped = true;
            break;
          }
          throw cbErr;
        }
      }
    }

    // Update live data for all open items (skip if circuit breaker tripped)
    let liveUpdateSummary = { updated: 0, closed: 0, errors: 0 };
    if (!circuitBreakerTripped) {
      log("Updating live auction data for open items...");
      liveUpdateSummary = await updateOpenItems();
    }

    return {
      total: watchlistItems.length,
      analyzed: analyzedCount,
      skipped: skippedCount,
      errors: errorCount,
      liveUpdated: liveUpdateSummary.updated,
      liveClosed: liveUpdateSummary.closed,
      liveErrors: liveUpdateSummary.errors,
      circuitBreakerTripped,
    };
  } finally {
    cbDb.close();
  }
}

export function printWatchlistSummary(summary: WatchlistSummary): void {
  console.log("");
  console.log("=== Watchlist Summary ===");
  console.log(`  Total items:    ${summary.total}`);
  console.log(`  Analyzed:       ${summary.analyzed}`);
  console.log(`  Skipped:        ${summary.skipped}`);
  console.log(`  Errors:         ${summary.errors}`);
  console.log(`  Live updated:   ${summary.liveUpdated}`);
  console.log(`  Newly closed:   ${summary.liveClosed}`);
  console.log(`  Live errors:    ${summary.liveErrors}`);
  if (summary.circuitBreakerTripped) {
    console.log(`  CIRCUIT BREAKER TRIPPED — batch halted`);
  }
  console.log("=========================");
}
