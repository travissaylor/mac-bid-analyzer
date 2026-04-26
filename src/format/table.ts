import type { ItemDisplayData } from "./display";
import {
  formatCurrency,
  formatDealScore,
  formatMaxBid,
} from "./display";

export function plainTextTableRow(data: ItemDisplayData): string {
  const maxBidStr = formatMaxBid(data.maxBid);
  const scoreStr = formatDealScore(data.dealScore);
  const status = data.isOpen ? "OPEN" : "CLOSED";
  const review = data.manualReview ? " [REVIEW]" : "";
  const name = data.productName.length > 38
    ? data.productName.slice(0, 37) + "…"
    : data.productName;

  return [
    String(data.lotId).padEnd(10),
    name.padEnd(40),
    data.condition.padEnd(10),
    formatCurrency(data.currentBid).padEnd(8),
    maxBidStr.padEnd(10),
    scoreStr.padEnd(8),
    (status + review).padEnd(8),
  ].join(" ");
}

export function plainTextTable(items: ItemDisplayData[]): string {
  const header = [
    "Lot ID".padEnd(10),
    "Product Name".padEnd(40),
    "Condition".padEnd(10),
    "Bid".padEnd(8),
    "Max Bid".padEnd(10),
    "Score".padEnd(8),
    "Status".padEnd(8),
  ].join(" ");

  const separator = "-".repeat(header.length);
  const rows = items.map((item) => plainTextTableRow(item));

  return [header, separator, ...rows].join("\n");
}
