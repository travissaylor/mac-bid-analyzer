export function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

export function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export function printUsage(): void {
  console.log(`${timestamp()} mac-bid-analyzer — Cross-reference mac.bid items with eBay sold listings`);
  console.log("");
  console.log("Usage: bun run src/main.ts <subcommand> [options]");
  console.log("");
  console.log("Subcommands:");
  console.log("  analyze <url|lotId>  Analyze a single mac.bid item");
  console.log("  results              Query and display stored analysis results");
  console.log("  detail <lotId>       Show full AI analysis for a specific item");
  console.log("  telegram             Start the Telegram bot in long-polling mode");
  console.log("  server               Start the HTTP API server");
  console.log("");
  console.log("Global options:");
  console.log("  --help               Show help for a subcommand");
  console.log("  --force              Re-analyze items that already exist in the DB");
  console.log("  --threshold <0-1>    Override discount threshold (e.g. 0.3)");
  console.log("  --model <p/m>        Override LLM provider/model (e.g. gemini/gemini-2.5-flash)");
  console.log("  --dry-run            Run without writing to the database");
}

export type Subcommand = "analyze" | "results" | "detail" | "telegram" | "server";

export interface ParsedCommand {
  subcommand: Subcommand | "help";
  input?: string;
  flags: {
    help: boolean;
    force: boolean;
    dryRun: boolean;
    threshold?: number;
    open: boolean;
    deals: boolean;
    review: boolean;
    /**
     * Three-state semantics:
     *   undefined — flag not provided (preserve existing persisted feedback)
     *   null      — flag provided with empty/whitespace value (clear feedback)
     *   string    — flag provided with non-empty value (set feedback)
     */
    userFeedback?: string | null;
    /**
     * True when the --feedback flag was present in argv (regardless of value).
     * Presence implies force at the call site.
     */
    feedbackProvided: boolean;
  };
}

export function parseArgs(args: string[]): ParsedCommand {
  const flags = {
    help: false,
    force: false,
    dryRun: false,
    threshold: undefined as number | undefined,
    open: false,
    deals: false,
    review: false,
    userFeedback: undefined as string | null | undefined,
    feedbackProvided: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--threshold") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--threshold requires a numeric value");
      }
      const val = Number(next);
      if (isNaN(val) || val <= 0 || val >= 1) {
        throw new Error("--threshold must be a number between 0 and 1 (exclusive)");
      }
      flags.threshold = val;
      i++;
    } else if (arg === "--open") {
      flags.open = true;
    } else if (arg === "--deals") {
      flags.deals = true;
    } else if (arg === "--review") {
      flags.review = true;
    } else if (arg === "--model") {
      // Consumed by parseCliOverrides in config.ts, skip the value
      i++;
    } else if (arg === "--feedback") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error('--feedback requires a value (use "" to clear existing feedback)');
      }
      flags.feedbackProvided = true;
      flags.userFeedback = next.trim() === "" ? null : next;
      i++;
    } else if (arg.startsWith("--feedback=")) {
      const value = arg.slice("--feedback=".length);
      flags.feedbackProvided = true;
      flags.userFeedback = value.trim() === "" ? null : value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const subcommand = positional[0];

  if (!subcommand || flags.help && !subcommand) {
    return { subcommand: "help", flags };
  }

  if (subcommand !== "analyze" && subcommand !== "results" && subcommand !== "detail" && subcommand !== "telegram" && subcommand !== "server") {
    throw new Error(`Unknown subcommand: ${subcommand}. Run with --help for usage.`);
  }

  const input = (subcommand === "analyze" || subcommand === "detail") ? positional[1] : undefined;

  if (subcommand === "analyze" && !flags.help && !input) {
    throw new Error("analyze requires an input (URL or lot ID). Run with --help for usage.");
  }

  if (subcommand === "detail" && !flags.help && !input) {
    throw new Error("detail requires a lot ID. Run with --help for usage.");
  }

  return { subcommand, input, flags };
}

const COMMANDS: Record<Subcommand, () => Promise<{ run: (args: string[]) => Promise<number> }>> = {
  analyze: () => import("./commands/analyze"),
  results: () => import("./commands/results"),
  detail: () => import("./commands/detail"),
  telegram: () => import("./commands/telegram"),
  server: () => import("./commands/server"),
};

/**
 * Parse argv (already sliced to remove `bun` and the script path) and
 * dispatch to the appropriate subcommand. Returns the process exit code.
 *
 * Long-running subcommands (telegram, server) start their own runtime
 * loop and return 0 immediately; the actual process keeps running because
 * those subsystems hold the event loop open.
 */
export async function dispatch(argv: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (parsed.subcommand === "help") {
    printUsage();
    return 0;
  }

  // Subcommand-specific help (e.g. `analyze --help`) is handled inside the
  // command module's own `run` so each command owns its help text.
  const loader = COMMANDS[parsed.subcommand];
  const mod = await loader();
  return mod.run(argv);
}
