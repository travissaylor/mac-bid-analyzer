// Pure URL parsing for mac.bid lot pages.
// No DOM, no chrome.* — safe to import from any entry point.

import type { LotInfo } from "./types";

export const LOT_URL_PATTERNS: RegExp[] = [
  // /auction/{auctionIdOrCode}/lot/{lotNumber}
  // auctionIdOrCode may be numeric (79197) or a human-readable code (WAB2604-19-A1)
  /\/auction\/([^/]+)\/lot\/([^/?#\s]+)/,
  // /lot/{lotId}
  /\/lot\/([^/?#\s]+)/,
];

export function extractLotInfo(url: string): LotInfo | null {
  const auctionLotMatch = url.match(LOT_URL_PATTERNS[0]!);
  if (auctionLotMatch) {
    return {
      type: "auction_lot",
      auctionId: auctionLotMatch[1],
      lotNumber: auctionLotMatch[2],
      lotId: auctionLotMatch[2]!,
      path: new URL(url).pathname,
    };
  }

  const lotMatch = url.match(LOT_URL_PATTERNS[1]!);
  if (lotMatch) {
    return {
      type: "lot",
      lotId: lotMatch[1]!,
      path: new URL(url).pathname,
    };
  }

  const parsed = new URL(url);
  const lid = parsed.searchParams.get("lid");
  if (lid) {
    const aid = parsed.searchParams.get("aid");
    const path = aid ? `/auction/${aid}/lot/${lid}` : `/lot/${lid}`;
    return {
      type: "auction_lot",
      auctionId: aid ?? undefined,
      lotNumber: lid,
      lotId: lid,
      path,
    };
  }

  return null;
}
