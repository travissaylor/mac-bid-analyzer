// eBay search cascade types are re-exported here so callers within
// src/analyze/ can import cascade result types from a local module.
// The cascade orchestration itself lives in src/ebay.ts.
export type { EbayPriceResult, CascadeResult } from "../ebay";
