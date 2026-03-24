import { Telegraf, Markup } from "telegraf";
import type { AnalyzedItem } from "./db";
import { openDatabase, getItemByLotId } from "./db";
import { parseLotId, resolveLotId, analyzeItem } from "./analyze";
import type { AnalyzeResult } from "./analyze";
import { loadConfig } from "./config";
import { clearBuildingsCache } from "./location";
import { syncLiveData } from "./sync";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSummaryHtml(item: AnalyzedItem): string {
  const lines: string[] = [];

  lines.push(`<b>${escapeHtml(item.product_name)}</b>`);
  lines.push("");
  lines.push(`<b>Lot:</b> ${item.lot_id}`);
  lines.push(`<b>Condition:</b> ${escapeHtml(item.condition)}`);
  lines.push(`<b>Location:</b> ${escapeHtml(item.auction_location ?? "Unknown")} (${escapeHtml(item.location_tier ?? "unknown")} tier)`);
  lines.push(`<b>Current Bid:</b> $${item.current_bid.toFixed(2)} (${item.total_bids} bids)`);

  if (item.ebay_sold_count > 0) {
    lines.push(`<b>eBay Median:</b> $${(item.ebay_sold_median ?? 0).toFixed(2)} (${item.ebay_sold_count} comps)`);
  } else {
    lines.push(`<b>eBay Comps:</b> None found`);
  }

  if (item.llm_provider && item.llm_estimate_mid !== null) {
    lines.push(`<b>AI Estimate:</b> $${item.llm_estimate_mid.toFixed(2)} (confidence: ${item.llm_confidence ?? "N/A"})`);
  }

  if (item.recommended_max_bid !== null) {
    if (item.recommended_max_bid <= 0) {
      lines.push(`<b>Max Bid:</b> $${item.recommended_max_bid.toFixed(2)} — NOT WORTH IT`);
    } else {
      lines.push(`<b>Max Bid:</b> $${item.recommended_max_bid.toFixed(2)}`);
    }
  } else {
    lines.push(`<b>Max Bid:</b> N/A`);
  }

  if (item.deal_score !== null) {
    lines.push(`<b>Deal Score:</b> ${item.deal_score.toFixed(0)}%`);
  }

  lines.push(`<b>Source:</b> ${escapeHtml(item.analysis_source)}`);

  if (item.needs_manual_review) {
    lines.push("");
    lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(item.manual_review_reason ?? "Unknown reason")}`);
  }

  return lines.join("\n");
}

function summaryKeyboard(lotId: number, cached: boolean) {
  const buttons = [
    Markup.button.callback("Full Details", `details:${lotId}`),
  ];
  if (cached) {
    buttons.push(Markup.button.callback("Re-analyze", `reanalyze:${lotId}`));
  }
  return Markup.inlineKeyboard(buttons);
}

function detailKeyboard(lotId: number) {
  return Markup.inlineKeyboard([
    Markup.button.callback("Summary", `summary:${lotId}`),
    Markup.button.callback("Re-analyze", `reanalyze:${lotId}`),
  ]);
}

function formatDetailHtml(item: AnalyzedItem): string {
  const lines: string[] = [];

  lines.push(`<b>${escapeHtml(item.product_name)}</b>`);
  lines.push("");
  lines.push(`<b>Lot:</b> ${item.lot_id}`);
  lines.push(`<b>Condition:</b> ${escapeHtml(item.condition)}`);
  lines.push(`<b>Location:</b> ${escapeHtml(item.auction_location ?? "Unknown")} (${escapeHtml(item.location_tier ?? "unknown")} tier)`);
  lines.push(`<b>Current Bid:</b> $${item.current_bid.toFixed(2)} (${item.total_bids} bids)`);

  // eBay section
  lines.push("");
  lines.push("<b>--- eBay Data ---</b>");
  if (item.ebay_sold_count > 0) {
    lines.push(`Low: $${(item.ebay_sold_low ?? 0).toFixed(2)} | Mid: $${(item.ebay_sold_median ?? 0).toFixed(2)} | High: $${(item.ebay_sold_high ?? 0).toFixed(2)}`);
    lines.push(`Comps: ${item.ebay_sold_count}`);
  } else {
    lines.push("No eBay comps found.");
  }

  // AI section
  lines.push("");
  lines.push("<b>--- AI Analysis ---</b>");
  if (item.llm_provider && item.llm_estimate_mid !== null) {
    lines.push(`Low: $${(item.llm_estimate_low ?? 0).toFixed(2)} | Mid: $${item.llm_estimate_mid.toFixed(2)} | High: $${(item.llm_estimate_high ?? 0).toFixed(2)}`);
    if (item.llm_confidence !== null) {
      lines.push(`Confidence: ${item.llm_confidence}/100`);
    }
    if (item.llm_reasoning) {
      lines.push("");
      lines.push(`<b>Reasoning:</b> ${escapeHtml(item.llm_reasoning)}`);
    }
    if (item.llm_comparables) {
      try {
        const comparables = JSON.parse(item.llm_comparables) as Array<{ name: string; estimatedPrice: number }>;
        if (comparables.length > 0) {
          lines.push("");
          lines.push("<b>Comparables:</b>");
          for (const comp of comparables) {
            lines.push(`  • ${escapeHtml(comp.name)}: $${comp.estimatedPrice.toFixed(2)}`);
          }
        }
      } catch {
        // ignore malformed comparables JSON
      }
    }
  } else {
    lines.push("No AI analysis available.");
  }

  // Cost breakdown
  lines.push("");
  lines.push("<b>--- Cost Breakdown ---</b>");

  if (item.analysis_source === "blended" && item.ebay_sold_median !== null && item.llm_estimate_mid !== null) {
    lines.push(`Blended: eBay $${item.ebay_sold_median.toFixed(2)} + AI $${item.llm_estimate_mid.toFixed(2)}`);
  } else if (item.analysis_source === "ebay-only" && item.ebay_sold_median !== null) {
    lines.push(`Base Estimate (eBay): $${item.ebay_sold_median.toFixed(2)}`);
  } else if (item.analysis_source === "ai-only" && item.llm_estimate_mid !== null) {
    lines.push(`Base Estimate (AI): $${item.llm_estimate_mid.toFixed(2)}`);
  }

  if (item.sales_tax_rate !== null) {
    lines.push(`Sales Tax Rate: ${(item.sales_tax_rate * 100).toFixed(1)}%`);
  }
  lines.push(`Location Cost: $${item.location_cost.toFixed(2)}`);

  // Recommendation
  lines.push("");
  lines.push("<b>--- Recommendation ---</b>");
  if (item.recommended_max_bid !== null) {
    if (item.recommended_max_bid <= 0) {
      lines.push(`<b>Max Bid:</b> $${item.recommended_max_bid.toFixed(2)} — NOT WORTH IT`);
    } else {
      lines.push(`<b>Max Bid:</b> $${item.recommended_max_bid.toFixed(2)}`);
    }
  } else {
    lines.push(`<b>Max Bid:</b> N/A`);
  }
  if (item.deal_score !== null) {
    lines.push(`<b>Deal Score:</b> ${item.deal_score.toFixed(0)}%`);
  }
  lines.push(`<b>Source:</b> ${escapeHtml(item.analysis_source)}`);

  if (item.needs_manual_review) {
    lines.push("");
    lines.push(`⚠️ <b>MANUAL REVIEW:</b> ${escapeHtml(item.manual_review_reason ?? "Unknown reason")}`);
  }

  return lines.join("\n");
}

/** Try to parse a mac.bid URL or lot ID from the message text. Returns null if not recognized. */
function extractInput(text: string): string | null {
  const trimmed = text.trim();

  // mac.bid URL
  if (/mac\.bid\/auction\/[^/]+\/lot\/[^/?\s]+/.test(trimmed)) {
    return trimmed;
  }

  // Bare number (lot ID)
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function formatActiveOverviewHtml(items: AnalyzedItem[]): string {
  if (items.length === 0) {
    return "No active items. Send a mac.bid URL or lot ID to analyze an item.";
  }

  // Sort by deal score descending (nulls last)
  const sorted = [...items].sort((a, b) => {
    if (a.deal_score === null && b.deal_score === null) return 0;
    if (a.deal_score === null) return 1;
    if (b.deal_score === null) return -1;
    return b.deal_score - a.deal_score;
  });

  const deals = sorted.filter(
    (i) => i.deal_score !== null && i.recommended_max_bid !== null && i.current_bid <= i.recommended_max_bid
  ).length;

  const lines: string[] = [];
  lines.push(`<b>${sorted.length} active item${sorted.length === 1 ? "" : "s"}, ${deals} deal${deals === 1 ? "" : "s"}</b>`);

  for (const item of sorted) {
    lines.push("");
    lines.push(`<b>${escapeHtml(item.product_name)}</b>`);
    lines.push(`Bid: $${item.current_bid.toFixed(2)}`);

    if (item.recommended_max_bid !== null) {
      lines.push(`Max: $${item.recommended_max_bid.toFixed(2)}`);
      if (item.current_bid > item.recommended_max_bid) {
        lines.push("⛔ over max");
      } else if (item.deal_score !== null) {
        lines.push(`Deal: ${item.deal_score.toFixed(0)}%`);
      }
    } else {
      lines.push("Max: N/A");
    }
  }

  return lines.join("\n");
}

export function startTelegramBot(): void {
  const token = Bun.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required");
    process.exit(1);
  }

  const allowedUserId = Bun.env.TELEGRAM_ALLOWED_USER_ID;
  if (!allowedUserId) {
    console.error("Error: TELEGRAM_ALLOWED_USER_ID environment variable is required");
    process.exit(1);
  }

  const allowedId = Number(allowedUserId);
  if (isNaN(allowedId)) {
    console.error("Error: TELEGRAM_ALLOWED_USER_ID must be a numeric user ID");
    process.exit(1);
  }

  const bot = new Telegraf(token);

  // Auth middleware — ignore or reply to unauthorized users
  bot.use((ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== allowedId) {
      if (ctx.message) {
        ctx.reply("Not authorized.");
      }
      return;
    }
    return next();
  });

  // /active command — show overview of open analyzed items
  bot.command("active", async (ctx) => {
    let statusMsg;
    try {
      statusMsg = await ctx.reply("Syncing...");
    } catch {
      return;
    }

    try {
      const db = openDatabase();
      try {
        const { items } = await syncLiveData(db);
        const html = formatActiveOverviewHtml(items);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          html,
          { parse_mode: "HTML" },
        );
        log(`Active overview: ${items.length} item(s)`);
      } finally {
        db.close();
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      log(`Active command error: ${errMsg}`);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `Error syncing active items: ${escapeHtml(errMsg)}`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Handle full details callback
  bot.action(/^details:(\d+)$/, async (ctx) => {
    const lotId = Number(ctx.match[1]);
    try {
      await ctx.answerCbQuery();
      const db = openDatabase();
      try {
        const item = getItemByLotId(db, lotId);
        if (!item) {
          await ctx.editMessageText(`No analysis found for lot ${lotId}.`);
          return;
        }
        const html = formatDetailHtml(item);
        const keyboard = detailKeyboard(lotId);
        await ctx.editMessageText(html, { parse_mode: "HTML", ...keyboard });
      } finally {
        db.close();
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      log(`Detail view error for lot ${lotId}: ${errMsg}`);
    }
  });

  // Handle summary callback (collapse back from detail)
  bot.action(/^summary:(\d+)$/, async (ctx) => {
    const lotId = Number(ctx.match[1]);
    try {
      await ctx.answerCbQuery();
      const db = openDatabase();
      try {
        const item = getItemByLotId(db, lotId);
        if (!item) {
          await ctx.editMessageText(`No analysis found for lot ${lotId}.`);
          return;
        }
        const html = formatSummaryHtml(item);
        const keyboard = summaryKeyboard(lotId, true);
        await ctx.editMessageText(html, { parse_mode: "HTML", ...keyboard });
      } finally {
        db.close();
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      log(`Summary view error for lot ${lotId}: ${errMsg}`);
    }
  });

  // Handle re-analyze callback
  bot.action(/^reanalyze:(\d+)$/, async (ctx) => {
    const lotId = Number(ctx.match[1]);
    try {
      await ctx.answerCbQuery("Re-analyzing...");
      await ctx.editMessageText("Re-analyzing...");

      const config = loadConfig();
      clearBuildingsCache();

      const resolved = await resolveLotId(lotId);
      const result = await analyzeItem(resolved.lotId, config, {
        force: true,
        ssrData: resolved.ssrData,
      });

      const html = formatSummaryHtml(result.item);
      const keyboard = summaryKeyboard(result.item.lot_id, false);
      await ctx.editMessageText(html, { parse_mode: "HTML", ...keyboard });
      log(`Re-analyzed lot ${lotId} via Telegram`);
    } catch (err) {
      const errMsg = (err as Error).message;
      log(`Re-analyze error for lot ${lotId}: ${errMsg}`);
      await ctx.editMessageText(`Error re-analyzing lot ${lotId}: ${escapeHtml(errMsg)}`, { parse_mode: "HTML" });
    }
  });

  // Handle text messages
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    const input = extractInput(text);

    if (!input) {
      await ctx.reply("I don't understand that message. Send a mac.bid URL or lot ID number to analyze an item.");
      return;
    }

    let statusMsg;
    try {
      statusMsg = await ctx.reply("Analyzing...");
    } catch {
      return;
    }

    try {
      const parsed = parseLotId(input);
      const config = loadConfig();
      clearBuildingsCache();

      const resolved = await resolveLotId(parsed);
      const result: AnalyzeResult = await analyzeItem(resolved.lotId, config, {
        ssrData: resolved.ssrData,
      });

      const html = formatSummaryHtml(result.item);
      const keyboard = summaryKeyboard(result.item.lot_id, result.skipped);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        html,
        { parse_mode: "HTML", ...keyboard },
      );
      log(`Analyzed lot ${resolved.lotId} via Telegram (${result.skipped ? "cached" : "fresh"})`);
    } catch (err) {
      const errMsg = (err as Error).message;
      log(`Analysis error: ${errMsg}`);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `Error: ${escapeHtml(errMsg)}`,
        { parse_mode: "HTML" },
      );
    }
  });

  bot.launch({ dropPendingUpdates: true });
  log("Telegram bot started in long-polling mode");

  // Graceful shutdown
  process.on("SIGINT", () => {
    log("Stopping bot...");
    bot.stop("SIGINT");
  });
  process.on("SIGTERM", () => {
    log("Stopping bot...");
    bot.stop("SIGTERM");
  });
}
