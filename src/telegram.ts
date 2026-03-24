import { Telegraf, Markup } from "telegraf";
import type { AnalyzedItem } from "./db";
import { parseLotId, resolveLotId, analyzeItem } from "./analyze";
import type { AnalyzeResult } from "./analyze";
import { loadConfig } from "./config";
import { clearBuildingsCache } from "./location";

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
