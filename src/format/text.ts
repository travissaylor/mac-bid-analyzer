import type { AnalyzedItem } from "../shared/types";
import type { ItemRenderer } from "./display";
import {
  formatCurrency,
  formatDealScore,
  formatImageFlagsSummary,
  formatMaxBid,
  formatTimeRemaining,
  isEndingSoon,
  resolveDisplayData,
  severityLabel,
  sortByEndingSoonest,
} from "./display";
import { plainTextTable, plainTextTableRow } from "./table";

// --- Plain text renderer ---

export const plainText: ItemRenderer<string> = {
  summary(data) {
    const lines: string[] = [];

    lines.push(data.productName);
    lines.push("");
    lines.push(`Lot: ${data.lotId}`);
    lines.push(`Condition: ${data.condition}`);
    lines.push(`Location: ${data.auctionLocation || "Unknown"} (${data.locationTier || "unknown"} tier)`);
    lines.push(`Current Bid: ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    if (data.ebay) {
      lines.push(`eBay Median: ${formatCurrency(data.ebay.median)} (${data.ebay.count} comps)`);
    } else {
      lines.push("eBay Comps: None found");
    }

    if (data.ai) {
      lines.push(`AI Estimate: ${formatCurrency(data.ai.mid)} (confidence: ${data.ai.confidence ?? "N/A"})`);
    }

    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: ${formatCurrency(data.maxBid.amount)} — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: ${formatMaxBid(data.maxBid)}`);
    }

    if (data.dealScore !== null) {
      lines.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }

    lines.push(`Source: ${data.analysisSource}`);

    if (data.imageFlags) {
      lines.push(`🔍 Image flags: ${formatImageFlagsSummary(data.imageFlags)}`);
    } else if (data.imageAnalysisSkipped) {
      lines.push("📷 No product photos available");
    }

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ MANUAL REVIEW: ${data.manualReview.reason}`);
    }

    return lines.join("\n");
  },

  detail(data) {
    const lines: string[] = [];

    lines.push(data.productName);
    lines.push("");
    lines.push(`Lot: ${data.lotId}`);
    lines.push(`Condition: ${data.condition}`);
    lines.push(`Location: ${data.auctionLocation || "Unknown"} (${data.locationTier || "unknown"} tier)`);
    lines.push(`Current Bid: ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    // eBay section
    lines.push("");
    lines.push("--- eBay Data ---");
    if (data.ebay) {
      lines.push(`Low: ${formatCurrency(data.ebay.low)} | Mid: ${formatCurrency(data.ebay.median)} | High: ${formatCurrency(data.ebay.high)}`);
      lines.push(`Comps: ${data.ebay.count}`);
    } else {
      lines.push("No eBay comps found.");
    }

    // AI section
    lines.push("");
    lines.push("--- AI Analysis ---");
    if (data.ai) {
      lines.push(`Low: ${formatCurrency(data.ai.low)} | Mid: ${formatCurrency(data.ai.mid)} | High: ${formatCurrency(data.ai.high)}`);
      if (data.ai.confidence !== null) {
        lines.push(`Confidence: ${data.ai.confidence}/100`);
      }
      if (data.ai.reasoning) {
        lines.push("");
        lines.push(`Reasoning: ${data.ai.reasoning}`);
      }
      if (data.ai.comparables.length > 0) {
        lines.push("");
        lines.push("Comparables:");
        for (const comp of data.ai.comparables) {
          lines.push(`  - ${comp.name}: ${formatCurrency(comp.estimatedPrice)}`);
        }
      }
    } else {
      lines.push("No AI analysis available.");
    }

    // Image flags section
    if (data.imageFlags) {
      lines.push("");
      lines.push("--- Image Flags ---");
      lines.push(`Risk Score: ${data.imageRiskScore ?? "N/A"}/100`);
      for (const flag of data.imageFlags) {
        lines.push(`  [${severityLabel(flag.severity)}] ${flag.description}`);
      }
    } else if (data.imageAnalysisSkipped) {
      lines.push("");
      lines.push("--- Image Flags ---");
      lines.push("No product photos available.");
    }

    // Cost breakdown
    lines.push("");
    lines.push("--- Cost Breakdown ---");
    if (data.analysisSource === "ebay" && data.ebay) {
      lines.push(`Base Estimate (eBay): ${formatCurrency(data.ebay.median)}`);
    } else if (data.analysisSource === "ai" && data.ai) {
      lines.push(`Base Estimate (AI): ${formatCurrency(data.ai.mid)}`);
    }
    if (data.salesTaxRate !== null) {
      lines.push(`Sales Tax Rate: ${(data.salesTaxRate * 100).toFixed(1)}%`);
    }
    lines.push(`Location Cost: ${formatCurrency(data.locationCost)}`);

    // Recommendation
    lines.push("");
    lines.push("--- Recommendation ---");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: ${formatCurrency(data.maxBid.amount)} — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: ${formatMaxBid(data.maxBid)}`);
    }
    if (data.dealScore !== null) {
      lines.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }
    lines.push(`Source: ${data.analysisSource}`);

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ MANUAL REVIEW: ${data.manualReview.reason}`);
    }

    return lines.join("\n");
  },

  tableRow(data) {
    return plainTextTableRow(data);
  },

  table(items) {
    return plainTextTable(items);
  },

  activeOverview(items) {
    if (items.length === 0) {
      return "No active items.";
    }

    const sorted = sortByEndingSoonest(items);

    const deals = sorted.filter((i) => i.isDeal).length;

    const lines: string[] = [];
    lines.push(`${sorted.length} active item${sorted.length === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}`);

    for (const item of sorted) {
      lines.push("");
      lines.push(item.productName);
      lines.push(`Bid: ${formatCurrency(item.currentBid)}`);
      const urgent = isEndingSoon(item.expectedCloseDate) ? "🔥 " : "";
      lines.push(`⏰ ${urgent}${formatTimeRemaining(item.expectedCloseDate)}`);

      if (item.maxBid.type === "value") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        if (item.isOverMax) {
          lines.push("⛔ over max");
        } else if (item.dealScore !== null) {
          lines.push(`Deal: ${formatDealScore(item.dealScore)}`);
        }
      } else if (item.maxBid.type === "not_worth_it") {
        lines.push(`Max: ${formatCurrency(item.maxBid.amount)}`);
        lines.push("⛔ over max");
      } else {
        lines.push("Max: N/A");
      }
    }

    return lines.join("\n");
  },
};

// --- Convenience wrappers ---

export function toTextSummary(item: AnalyzedItem): string {
  return plainText.summary!(resolveDisplayData(item));
}

export function toTextDetail(item: AnalyzedItem): string {
  return plainText.detail!(resolveDisplayData(item));
}

export function toTextTableRow(item: AnalyzedItem): string {
  return plainText.tableRow!(resolveDisplayData(item));
}
