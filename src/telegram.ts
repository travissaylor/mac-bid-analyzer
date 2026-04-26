import { Telegraf, Markup } from "telegraf";
import { openDatabase, getItemByLotId } from "./db";
import { parseLotId, resolveLotId, analyzeItem } from "./analyze";
import type { AnalyzeResult } from "./shared/types";
import { loadConfig, validateTelegramEnv } from "./config";
import { clearBuildingsCache } from "./location";
import { syncLiveData } from "./sync";
import { toHtmlSummary, toHtmlDetail, toHtmlActiveOverview, escapeHtml } from "./format";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
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
  const { token, allowedUserId: allowedId } = validateTelegramEnv();

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
        const html = toHtmlActiveOverview(items);
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

  // /help command — list available commands and usage
  bot.command("help", async (ctx) => {
    const html = [
      "<b>mac.bid Analyzer Bot</b>",
      "",
      "<b>Commands:</b>",
      "/active — Show all open analyzed items with live data",
      "/help — Show this help message",
      "",
      "<b>Usage:</b>",
      "Send a mac.bid URL or a bare lot ID number to analyze an item.",
    ].join("\n");
    await ctx.reply(html, { parse_mode: "HTML" });
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
        const html = toHtmlDetail(item);
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
        const html = toHtmlSummary(item);
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

      const html = toHtmlSummary(result.item);
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

      const html = toHtmlSummary(result.item);
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
