import { Telegraf } from "telegraf";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
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

  bot.on("message", (_ctx) => {
    // Placeholder — message handling will be added in US-005
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
