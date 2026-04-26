import type { AnalyzedItem } from "../shared/types";
import type { ItemRenderer } from "./display";
import {
  escapeHtml,
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

// --- Telegram HTML renderer ---

export const telegramHtml: ItemRenderer<string> = {
  summary(data) {
    const lines: string[] = [];

    lines.push(`<b>${escapeHtml(data.productName)}</b>`);
    lines.push(`Lot: ${data.lotId} · ${escapeHtml(data.condition)}`);
    lines.push(`📍 ${escapeHtml(data.auctionLocation || "Unknown")} · ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);
    lines.push("");

    if (data.ebay) {
      lines.push(`📊 eBay: ${formatCurrency(data.ebay.median)} (${data.ebay.count} comps)`);
    } else {
      lines.push("📊 eBay: None found");
    }

    if (data.ai) {
      lines.push(`🤖 AI: ${formatCurrency(data.ai.mid)} (confidence: ${data.ai.confidence ?? "N/A"})`);
    }

    lines.push("");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`✅ Max Bid: <b>${formatCurrency(data.maxBid.amount)}</b> — NOT WORTH IT`);
    } else {
      lines.push(`✅ Max Bid: <b>${formatMaxBid(data.maxBid)}</b>`);
    }

    const metaParts: string[] = [];
    if (data.dealScore !== null) {
      metaParts.push(`Deal: ${formatDealScore(data.dealScore)}`);
    }
    metaParts.push(`Source: ${escapeHtml(data.analysisSource)}`);
    lines.push(metaParts.join(" · "));

    if (data.imageFlags) {
      lines.push(`🔍 Image flags: ${escapeHtml(formatImageFlagsSummary(data.imageFlags))}`);
    } else if (data.imageAnalysisSkipped) {
      lines.push("📷 No product photos available");
    }

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(data.manualReview.reason)}`);
    }

    return lines.join("\n");
  },

  detail(data) {
    const lines: string[] = [];

    lines.push(`<b>${escapeHtml(data.productName)}</b>`);
    lines.push(`Lot: ${data.lotId} · ${escapeHtml(data.condition)}`);
    lines.push(`📍 ${escapeHtml(data.auctionLocation || "Unknown")} · ${formatCurrency(data.currentBid)} (${data.totalBids} bids)`);

    // eBay section
    lines.push("");
    lines.push("📊 <b>eBay Data</b>");
    if (data.ebay) {
      lines.push(`${formatCurrency(data.ebay.low)} | ${formatCurrency(data.ebay.median)} | ${formatCurrency(data.ebay.high)}`);
      lines.push(`Comps: ${data.ebay.count}`);
    } else {
      lines.push("No eBay comps found.");
    }

    // AI section
    lines.push("");
    lines.push("🤖 <b>AI Analysis</b>");
    if (data.ai) {
      lines.push(`${formatCurrency(data.ai.low)} — ${formatCurrency(data.ai.mid)} — ${formatCurrency(data.ai.high)}`);
      if (data.ai.confidence !== null) {
        lines.push(`Confidence: ${data.ai.confidence}/100`);
      }
      if (data.ai.reasoning) {
        lines.push("");
        lines.push(`💬 ${escapeHtml(data.ai.reasoning)}`);
      }
      if (data.ai.comparables.length > 0) {
        lines.push("");
        lines.push("📋 <b>Comparables</b>");
        for (const comp of data.ai.comparables) {
          lines.push(`  • ${escapeHtml(comp.name)}: ${formatCurrency(comp.estimatedPrice)}`);
        }
      }
    } else {
      lines.push("No AI analysis available.");
    }

    // Image flags section
    if (data.imageFlags) {
      lines.push("");
      lines.push("🔍 <b>Image Flags</b>");
      lines.push(`Risk Score: ${data.imageRiskScore ?? "N/A"}/100`);
      for (const flag of data.imageFlags) {
        lines.push(`  • [${severityLabel(flag.severity)}] ${escapeHtml(flag.description)}`);
      }
    } else if (data.imageAnalysisSkipped) {
      lines.push("");
      lines.push("🔍 <b>Image Flags</b>");
      lines.push("No product photos available.");
    }

    // Cost breakdown
    lines.push("");
    lines.push("💵 <b>Costs</b>");
    if (data.analysisSource === "ebay" && data.ebay) {
      lines.push(`Base: ${formatCurrency(data.ebay.median)} (eBay)`);
    } else if (data.analysisSource === "ai" && data.ai) {
      lines.push(`Base: ${formatCurrency(data.ai.mid)} (AI)`);
    }
    const costParts: string[] = [];
    if (data.salesTaxRate !== null) {
      costParts.push(`Tax: ${(data.salesTaxRate * 100).toFixed(1)}%`);
    }
    costParts.push(`Location: ${formatCurrency(data.locationCost)}`);
    lines.push(costParts.join(" · "));

    // Recommendation
    lines.push("");
    lines.push("✅ <b>Recommendation</b>");
    if (data.maxBid.type === "not_worth_it") {
      lines.push(`Max Bid: <b>${formatCurrency(data.maxBid.amount)}</b> — NOT WORTH IT`);
    } else {
      lines.push(`Max Bid: <b>${formatMaxBid(data.maxBid)}</b>`);
    }
    const recParts: string[] = [];
    if (data.dealScore !== null) {
      recParts.push(`Deal Score: ${formatDealScore(data.dealScore)}`);
    }
    recParts.push(`Source: ${escapeHtml(data.analysisSource)}`);
    lines.push(recParts.join(" · "));

    if (data.manualReview) {
      lines.push("");
      lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(data.manualReview.reason)}`);
    }

    return lines.join("\n");
  },

  activeOverview(items) {
    if (items.length === 0) {
      return "No active items. Send a mac.bid URL or lot ID to analyze an item.";
    }

    const sorted = sortByEndingSoonest(items);

    const deals = sorted.filter((i) => i.isDeal).length;

    const lines: string[] = [];
    lines.push(`<b>${sorted.length} active item${sorted.length === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}</b>`);

    for (const item of sorted) {
      lines.push("");
      lines.push(`<b>${escapeHtml(item.productName)}</b>`);
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

export function toHtmlSummary(item: AnalyzedItem): string {
  return telegramHtml.summary!(resolveDisplayData(item));
}

export function toHtmlDetail(item: AnalyzedItem): string {
  return telegramHtml.detail!(resolveDisplayData(item));
}

export function toHtmlActiveOverview(items: AnalyzedItem[]): string {
  return telegramHtml.activeOverview!(items.map(resolveDisplayData));
}
