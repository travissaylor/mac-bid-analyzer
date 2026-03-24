# SQLite Schema

[← Back to Project](./PROJECT.md)

## Database File

`data.db` at the project root. Gitignored.

## Tables

### analyzed_items

The primary table. One row per analyzed lot.

```sql
CREATE TABLE analyzed_items (
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

  -- Live data (updated on demand for open items)
  is_open           INTEGER NOT NULL DEFAULT 1,
  current_bid       REAL DEFAULT 0,
  total_bids        INTEGER DEFAULT 0,
  watchers_count    INTEGER DEFAULT 0,
  live_updated_at   TEXT,

  -- eBay analysis (set once, never re-run unless --force)
  ebay_sold_median  REAL,
  ebay_sold_low     REAL,
  ebay_sold_high    REAL,
  ebay_sold_count   INTEGER DEFAULT 0,
  ebay_search_query TEXT,

  -- LLM fallback (when ebay_sold_count < 5)
  llm_estimate_low  REAL,
  llm_estimate_mid  REAL,
  llm_estimate_high REAL,
  llm_provider      TEXT,

  -- Calculated recommendation
  recommended_max_bid REAL,
  sales_tax_rate    REAL,
  location_cost     REAL DEFAULT 0,
  location_tier     TEXT,  -- 'home', 'transfer', 'remote'
  deal_score        REAL,
  needs_manual_review INTEGER NOT NULL DEFAULT 0,
  manual_review_reason TEXT,

  -- Metadata
  analyzed_at       TEXT NOT NULL,
  analysis_source   TEXT NOT NULL  -- 'ebay', 'ai', 'blended', 'none', 'manual_review'
);
```

## Key Queries

### Items worth bidding on (open, has recommendation, current bid below max)

```sql
SELECT * FROM analyzed_items
WHERE is_open = 1
  AND recommended_max_bid IS NOT NULL
  AND current_bid < recommended_max_bid
ORDER BY deal_score DESC;
```

### Items needing manual review

```sql
SELECT * FROM analyzed_items
WHERE is_open = 1
  AND needs_manual_review = 1
ORDER BY expected_close_date ASC;
```

### All open items sorted by closing time

```sql
SELECT * FROM analyzed_items
WHERE is_open = 1
ORDER BY expected_close_date ASC;
```

### Check if item already analyzed

```sql
SELECT lot_id FROM analyzed_items WHERE lot_id = ?;
-- If no row returned, item needs analysis
```

### Open items needing live data update

```sql
SELECT lot_id FROM analyzed_items WHERE is_open = 1;
```

## Deal Score Calculation

`deal_score` quantifies how good a deal is, for sorting.

```
deal_score = (recommended_max_bid - current_bid) / recommended_max_bid * 100
```

- Score of 90 = current bid is 90% below your max (amazing deal, probably early in auction)
- Score of 10 = current bid is close to your max (still a deal, but tight)
- Score of 0 or negative = current bid exceeds your max (skip)

Deal score is updated whenever live data is refreshed.

## Indexes

```sql
CREATE INDEX idx_analyzed_items_is_open ON analyzed_items(is_open);
CREATE INDEX idx_analyzed_items_auction_id ON analyzed_items(auction_id);
CREATE INDEX idx_analyzed_items_category ON analyzed_items(category);
CREATE INDEX idx_analyzed_items_condition ON analyzed_items(condition);
CREATE INDEX idx_analyzed_items_deal_score ON analyzed_items(deal_score);
```
