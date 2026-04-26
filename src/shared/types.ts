// Cross-module types shared between feature modules.

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
  llm_confidence: number | null;
  llm_reasoning: string | null;
  llm_comparables: string | null;
  recommended_max_bid: number | null;
  sales_tax_rate: number | null;
  location_cost: number;
  location_tier: string | null;
  discount_threshold: number | null;
  lot_fee: number | null;
  buyers_premium_rate: number | null;
  deal_score: number | null;
  image_flags: string | null;
  image_risk_score: number | null;
  image_analysis_skipped: number | null;
  needs_manual_review: number;
  manual_review_reason: string | null;
  analyzed_at: string;
  analysis_source: string;
  user_feedback: string | null;
}

export interface AnalyzeResult {
  item: AnalyzedItem;
  skipped: boolean;
}
