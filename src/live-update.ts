import { openDatabase, getOpenItems, updateLiveData } from "./db";
import type { LiveData } from "./db";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

const MACBID_LOT_URL = "https://api.mac.bid/map-bid/ddb/lot";

export interface LiveLotResponse {
  current_bid: number;
  total_bids: number;
  watchers_count: number;
  is_open: boolean;
}

export async function fetchLotLiveData(lotId: number): Promise<LiveLotResponse> {
  const url = `${MACBID_LOT_URL}/${lotId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch live data for lot ${lotId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid live data response for lot ${lotId}`);
  }

  return {
    current_bid: data.current_bid ?? 0,
    total_bids: data.total_bids ?? 0,
    watchers_count: data.watchers_count ?? 0,
    is_open: data.is_open !== undefined ? Boolean(data.is_open) : true,
  };
}

export interface LiveUpdateSummary {
  total: number;
  updated: number;
  closed: number;
  errors: number;
}

export async function updateOpenItems(projectRoot?: string): Promise<LiveUpdateSummary> {
  const db = openDatabase(projectRoot);

  try {
    const openItems = getOpenItems(db);

    if (openItems.length === 0) {
      log("No open items to update.");
      return { total: 0, updated: 0, closed: 0, errors: 0 };
    }

    log(`Updating live data for ${openItems.length} open item(s)...`);

    let updated = 0;
    let closed = 0;
    let errors = 0;

    for (const item of openItems) {
      try {
        const liveData = await fetchLotLiveData(item.lot_id);

        const dbLiveData: LiveData = {
          current_bid: liveData.current_bid,
          total_bids: liveData.total_bids,
          watchers_count: liveData.watchers_count,
          is_open: liveData.is_open ? 1 : 0,
        };

        updateLiveData(db, item.lot_id, dbLiveData);
        updated++;

        if (!liveData.is_open) {
          closed++;
          log(`Lot ${item.lot_id} is now CLOSED (bid: $${liveData.current_bid.toFixed(2)})`);
        }
      } catch (err) {
        errors++;
        log(`Error updating lot ${item.lot_id}: ${(err as Error).message}`);
      }
    }

    log(`Live update complete: ${updated} updated, ${closed} closed, ${errors} error(s).`);
    return { total: openItems.length, updated, closed, errors };
  } finally {
    db.close();
  }
}
