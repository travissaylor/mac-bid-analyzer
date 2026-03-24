import type { Database } from "bun:sqlite";
import type { AnalyzedItem } from "./db";
import { getOpenItems, updateLiveData } from "./db";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

const MACBID_DDB_URL = "https://api.macdiscount.com/map-bid/ddb/lot";

export interface SyncResult {
  synced: number;
  failed: number;
  closed: number;
}

/**
 * Sync live bid/status data from the mac.bid DDB API for all open items.
 * Updates current_bid, total_bids, watchers_count, is_open, live_updated_at,
 * and recalculates deal_score in the database.
 *
 * Returns the refreshed list of open items (after sync) and sync stats.
 */
export async function syncLiveData(
  db: Database
): Promise<{ items: AnalyzedItem[]; result: SyncResult }> {
  const openItems = getOpenItems(db);

  if (openItems.length === 0) {
    log("No open items to sync.");
    return { items: [], result: { synced: 0, failed: 0, closed: 0 } };
  }

  log(`Syncing live data for ${openItems.length} open item(s)...`);

  let synced = 0;
  let failed = 0;
  let closed = 0;

  for (const item of openItems) {
    try {
      const response = await fetch(`${MACBID_DDB_URL}/${item.lot_id}`);
      if (!response.ok) {
        log(`Warning: Failed to fetch live data for lot ${item.lot_id}: ${response.status}`);
        failed++;
        continue;
      }

      const data = await response.json();
      const isOpen = data.is_open !== undefined ? Boolean(data.is_open) : true;

      updateLiveData(db, item.lot_id, {
        current_bid: Number(data.current_bid ?? 0),
        total_bids: Number(data.total_bids ?? 0),
        watchers_count: Number(data.watchers_count ?? 0),
        is_open: isOpen ? 1 : 0,
      });

      synced++;
      if (!isOpen) {
        closed++;
      }
    } catch (err) {
      log(`Warning: Error syncing lot ${item.lot_id}: ${(err as Error).message}`);
      failed++;
    }
  }

  log(`Sync complete: ${synced} updated, ${closed} closed, ${failed} failed.`);

  // Return fresh data after sync
  const refreshedItems = getOpenItems(db);
  return {
    items: refreshedItems,
    result: { synced, failed, closed },
  };
}
