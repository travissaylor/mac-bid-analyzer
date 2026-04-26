import { startTelegramBot } from "../../telegram";

export async function run(_args: string[]): Promise<number> {
  // Long-running: returns immediately, but Telegraf keeps the event loop alive.
  startTelegramBot();
  return 0;
}
