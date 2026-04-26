import { startServer } from "../../server";

export async function run(_args: string[]): Promise<number> {
  // Long-running: returns immediately, but Bun.serve keeps the event loop alive.
  startServer();
  return 0;
}
