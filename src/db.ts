import { Database } from "bun:sqlite";
import { join } from "path";

export interface AnalyzedItem {
  lot_id: number;
  auction_id: number;
  lot_number: string;
  product_name: string;
  upc: string | null;
  condition: string;
  retail_price: number | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  building_id: number | null;
  location_id: number | null;
  auction_location: string | null;
  expected_close_date: string | null;
  is_open: number;
  current_bid: number;
  total_bids: number;
  watchers_count: number;
  live_updated_at: string | null;
  ebay_sold_median: number | null;
  ebay_sold_low: number | null;
  ebay_sold_high: number | null;
  ebay_sold_count: number;
  ebay_search_query: string | null;
  llm_estimate_low: number | null;
  llm_estimate_mid: number | null;
  llm_estimate_high: number | null;
  llm_provider: string | null;
  recommended_max_bid: number | null;
  sales_tax_rate: number | null;
  location_cost: number;
  location_tier: string | null;
  deal_score: number | null;
  needs_manual_review: number;
  manual_review_reason: string | null;
  analyzed_at: string;
  analysis_source: string;
}

export interface ErrorLogEntry {
  error_type: string;
  error_message: string;
  lot_id: number | null;
}

export interface CircuitBreakerRow {
  error_type: string;
  consecutive_failures: number;
  first_failure_at: string;
  last_failure_at: string;
  notified: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analyzed_items (
  lot_id            INTEGER PRIMARY KEY,
  auction_id        INTEGER NOT NULL,
  lot_number        TEXT NOT NULL,
  product_name      TEXT NOT NULL,
  upc               TEXT,
  condition         TEXT NOT NULL,
  retail_price      REAL,
  category          TEXT,
  description       TEXT,
  image_url         TEXT,
  building_id       INTEGER,
  location_id       INTEGER,
  auction_location  TEXT,
  expected_close_date TEXT,

  is_open           INTEGER NOT NULL DEFAULT 1,
  current_bid       REAL DEFAULT 0,
  total_bids        INTEGER DEFAULT 0,
  watchers_count    INTEGER DEFAULT 0,
  live_updated_at   TEXT,

  ebay_sold_median  REAL,
  ebay_sold_low     REAL,
  ebay_sold_high    REAL,
  ebay_sold_count   INTEGER DEFAULT 0,
  ebay_search_query TEXT,

  llm_estimate_low  REAL,
  llm_estimate_mid  REAL,
  llm_estimate_high REAL,
  llm_provider      TEXT,

  recommended_max_bid REAL,
  sales_tax_rate    REAL,
  location_cost     REAL DEFAULT 0,
  location_tier     TEXT,
  deal_score        REAL,
  needs_manual_review INTEGER NOT NULL DEFAULT 0,
  manual_review_reason TEXT,

  analyzed_at       TEXT NOT NULL,
  analysis_source   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  error_type      TEXT NOT NULL,
  error_message   TEXT NOT NULL,
  lot_id          INTEGER,
  occurred_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS circuit_breaker (
  error_type          TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at    TEXT NOT NULL,
  last_failure_at     TEXT NOT NULL,
  notified            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analyzed_items_is_open ON analyzed_items(is_open);
CREATE INDEX IF NOT EXISTS idx_analyzed_items_auction_id ON analyzed_items(auction_id);
CREATE INDEX IF NOT EXISTS idx_analyzed_items_category ON analyzed_items(category);
CREATE INDEX IF NOT EXISTS idx_analyzed_items_condition ON analyzed_items(condition);
CREATE INDEX IF NOT EXISTS idx_analyzed_items_deal_score ON analyzed_items(deal_score);
CREATE INDEX IF NOT EXISTS idx_error_log_type_time ON error_log(error_type, occurred_at);
`;

export function openDatabase(projectRoot?: string): Database {
  const root = projectRoot ?? process.cwd();
  const dbPath = join(root, "data.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

export function upsertAnalyzedItem(db: Database, item: AnalyzedItem): void {
  const stmt = db.prepare(`
    INSERT INTO analyzed_items (
      lot_id, auction_id, lot_number, product_name, upc, condition,
      retail_price, category, description, image_url, building_id,
      location_id, auction_location, expected_close_date,
      is_open, current_bid, total_bids, watchers_count, live_updated_at,
      ebay_sold_median, ebay_sold_low, ebay_sold_high, ebay_sold_count, ebay_search_query,
      llm_estimate_low, llm_estimate_mid, llm_estimate_high, llm_provider,
      recommended_max_bid, sales_tax_rate, location_cost, location_tier,
      deal_score, needs_manual_review, manual_review_reason,
      analyzed_at, analysis_source
    ) VALUES (
      $lot_id, $auction_id, $lot_number, $product_name, $upc, $condition,
      $retail_price, $category, $description, $image_url, $building_id,
      $location_id, $auction_location, $expected_close_date,
      $is_open, $current_bid, $total_bids, $watchers_count, $live_updated_at,
      $ebay_sold_median, $ebay_sold_low, $ebay_sold_high, $ebay_sold_count, $ebay_search_query,
      $llm_estimate_low, $llm_estimate_mid, $llm_estimate_high, $llm_provider,
      $recommended_max_bid, $sales_tax_rate, $location_cost, $location_tier,
      $deal_score, $needs_manual_review, $manual_review_reason,
      $analyzed_at, $analysis_source
    ) ON CONFLICT(lot_id) DO UPDATE SET
      auction_id = excluded.auction_id,
      lot_number = excluded.lot_number,
      product_name = excluded.product_name,
      upc = excluded.upc,
      condition = excluded.condition,
      retail_price = excluded.retail_price,
      category = excluded.category,
      description = excluded.description,
      image_url = excluded.image_url,
      building_id = excluded.building_id,
      location_id = excluded.location_id,
      auction_location = excluded.auction_location,
      expected_close_date = excluded.expected_close_date,
      is_open = excluded.is_open,
      current_bid = excluded.current_bid,
      total_bids = excluded.total_bids,
      watchers_count = excluded.watchers_count,
      live_updated_at = excluded.live_updated_at,
      ebay_sold_median = excluded.ebay_sold_median,
      ebay_sold_low = excluded.ebay_sold_low,
      ebay_sold_high = excluded.ebay_sold_high,
      ebay_sold_count = excluded.ebay_sold_count,
      ebay_search_query = excluded.ebay_search_query,
      llm_estimate_low = excluded.llm_estimate_low,
      llm_estimate_mid = excluded.llm_estimate_mid,
      llm_estimate_high = excluded.llm_estimate_high,
      llm_provider = excluded.llm_provider,
      recommended_max_bid = excluded.recommended_max_bid,
      sales_tax_rate = excluded.sales_tax_rate,
      location_cost = excluded.location_cost,
      location_tier = excluded.location_tier,
      deal_score = excluded.deal_score,
      needs_manual_review = excluded.needs_manual_review,
      manual_review_reason = excluded.manual_review_reason,
      analyzed_at = excluded.analyzed_at,
      analysis_source = excluded.analysis_source
  `);

  stmt.run({
    $lot_id: item.lot_id,
    $auction_id: item.auction_id,
    $lot_number: item.lot_number,
    $product_name: item.product_name,
    $upc: item.upc,
    $condition: item.condition,
    $retail_price: item.retail_price,
    $category: item.category,
    $description: item.description,
    $image_url: item.image_url,
    $building_id: item.building_id,
    $location_id: item.location_id,
    $auction_location: item.auction_location,
    $expected_close_date: item.expected_close_date,
    $is_open: item.is_open,
    $current_bid: item.current_bid,
    $total_bids: item.total_bids,
    $watchers_count: item.watchers_count,
    $live_updated_at: item.live_updated_at,
    $ebay_sold_median: item.ebay_sold_median,
    $ebay_sold_low: item.ebay_sold_low,
    $ebay_sold_high: item.ebay_sold_high,
    $ebay_sold_count: item.ebay_sold_count,
    $ebay_search_query: item.ebay_search_query,
    $llm_estimate_low: item.llm_estimate_low,
    $llm_estimate_mid: item.llm_estimate_mid,
    $llm_estimate_high: item.llm_estimate_high,
    $llm_provider: item.llm_provider,
    $recommended_max_bid: item.recommended_max_bid,
    $sales_tax_rate: item.sales_tax_rate,
    $location_cost: item.location_cost,
    $location_tier: item.location_tier,
    $deal_score: item.deal_score,
    $needs_manual_review: item.needs_manual_review,
    $manual_review_reason: item.manual_review_reason,
    $analyzed_at: item.analyzed_at,
    $analysis_source: item.analysis_source,
  });
}

export function getItemByLotId(db: Database, lotId: number): AnalyzedItem | null {
  const stmt = db.prepare("SELECT * FROM analyzed_items WHERE lot_id = ?");
  return (stmt.get(lotId) as AnalyzedItem | null) ?? null;
}

export function getOpenItems(db: Database): AnalyzedItem[] {
  const stmt = db.prepare("SELECT * FROM analyzed_items WHERE is_open = 1");
  return stmt.all() as AnalyzedItem[];
}

export interface LiveData {
  current_bid: number;
  total_bids: number;
  watchers_count: number;
  is_open: number;
}

export function updateLiveData(db: Database, lotId: number, data: LiveData): void {
  const now = new Date().toISOString();

  const item = getItemByLotId(db, lotId);
  let dealScore: number | null = null;
  if (item?.recommended_max_bid && item.recommended_max_bid > 0) {
    dealScore = ((item.recommended_max_bid - data.current_bid) / item.recommended_max_bid) * 100;
  }

  const stmt = db.prepare(`
    UPDATE analyzed_items
    SET current_bid = ?, total_bids = ?, watchers_count = ?, is_open = ?,
        live_updated_at = ?, deal_score = ?
    WHERE lot_id = ?
  `);
  stmt.run(data.current_bid, data.total_bids, data.watchers_count, data.is_open, now, dealScore, lotId);
}

export function logError(db: Database, entry: ErrorLogEntry): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO error_log (error_type, error_message, lot_id, occurred_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(entry.error_type, entry.error_message, entry.lot_id, now);
}

export function recordCircuitBreakerFailure(db: Database, errorType: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO circuit_breaker (error_type, consecutive_failures, first_failure_at, last_failure_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(error_type) DO UPDATE SET
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = excluded.last_failure_at
  `);
  stmt.run(errorType, now, now);
}

export function resetCircuitBreaker(db: Database, errorType: string): void {
  const stmt = db.prepare("DELETE FROM circuit_breaker WHERE error_type = ?");
  stmt.run(errorType);
}

export function getTrippedBreakers(db: Database, threshold: number): CircuitBreakerRow[] {
  const stmt = db.prepare(
    "SELECT * FROM circuit_breaker WHERE consecutive_failures >= ? AND notified = 0"
  );
  return stmt.all(threshold) as CircuitBreakerRow[];
}

export function markBreakerNotified(db: Database, errorType: string): void {
  const stmt = db.prepare("UPDATE circuit_breaker SET notified = 1 WHERE error_type = ?");
  stmt.run(errorType);
}
