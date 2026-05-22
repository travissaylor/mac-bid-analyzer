import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface LocationTiers {
  transfer: { extra_cost: number };
  remote: { extra_cost: number };
}

export interface ConfigFile {
  home_building_ids: number[];
  discount_threshold: number;
  lot_fee: number;
  buyers_premium_rate: number;
  min_ebay_comps: number;
  location_tiers: LocationTiers;
  manual_review_conditions: string[];
  llm_model: string;
}

export interface CliOverrides {
  force?: boolean;
  threshold?: number;
  dryRun?: boolean;
  model?: string;
}

export interface AppConfig extends ConfigFile {
  env: {
    ebayAppId: string;
    ebayAppSecret: string;
    geminiApiKey: string;
    openaiApiKey: string;
  };
  cli: CliOverrides;
}

const DEFAULTS: ConfigFile = {
  home_building_ids: [15, 16, 6, 1],
  discount_threshold: 0.3,
  lot_fee: 3.0,
  buyers_premium_rate: 0.15,
  min_ebay_comps: 5,
  location_tiers: {
    transfer: { extra_cost: 10 },
    remote: { extra_cost: 25 },
  },
  manual_review_conditions: ["USED", "SALVAGE", "DAMAGED"],
  llm_model: "gemini/gemini-3.1-flash-lite",
};

function validateConfig(config: ConfigFile): string[] {
  const errors: string[] = [];

  if (!Array.isArray(config.home_building_ids)) {
    errors.push("home_building_ids must be an array of numbers");
  } else if (config.home_building_ids.some((id) => typeof id !== "number" || !Number.isInteger(id))) {
    errors.push("home_building_ids must contain only integers");
  }

  if (typeof config.discount_threshold !== "number" || config.discount_threshold <= 0 || config.discount_threshold >= 1) {
    errors.push("discount_threshold must be a number between 0 and 1 (exclusive)");
  }

  if (typeof config.lot_fee !== "number" || config.lot_fee < 0) {
    errors.push("lot_fee must be a non-negative number");
  }

  if (typeof config.buyers_premium_rate !== "number" || config.buyers_premium_rate < 0 || config.buyers_premium_rate >= 1) {
    errors.push("buyers_premium_rate must be a number between 0 and 1 (exclusive)");
  }

  if (typeof config.min_ebay_comps !== "number" || !Number.isInteger(config.min_ebay_comps) || config.min_ebay_comps < 1) {
    errors.push("min_ebay_comps must be a positive integer");
  }

  if (typeof config.location_tiers !== "object" || config.location_tiers === null) {
    errors.push("location_tiers must be an object with transfer and remote keys");
  } else {
    if (typeof config.location_tiers.transfer?.extra_cost !== "number" || config.location_tiers.transfer.extra_cost < 0) {
      errors.push("location_tiers.transfer.extra_cost must be a non-negative number");
    }
    if (typeof config.location_tiers.remote?.extra_cost !== "number" || config.location_tiers.remote.extra_cost < 0) {
      errors.push("location_tiers.remote.extra_cost must be a non-negative number");
    }
  }

  if (!Array.isArray(config.manual_review_conditions)) {
    errors.push("manual_review_conditions must be an array of strings");
  } else if (config.manual_review_conditions.some((c) => typeof c !== "string")) {
    errors.push("manual_review_conditions must contain only strings");
  }

  if (typeof config.llm_model !== "string" || !/^[a-z]+\/.+$/.test(config.llm_model)) {
    errors.push('llm_model must be in "provider/model-name" format (e.g. "openai/gpt-4o-mini")');
  } else {
    const provider = config.llm_model.split("/")[0];
    if (provider !== "openai" && provider !== "gemini") {
      errors.push(`llm_model provider "${provider}" is not supported (use "openai" or "gemini")`);
    }
  }

  return errors;
}

function resolveModel(parsed: Record<string, unknown>): string {
  if (typeof parsed.llm_model === "string") {
    return parsed.llm_model;
  }
  if (typeof parsed.gemini_model === "string") {
    console.warn(
      '[config] "gemini_model" is deprecated — use "llm_model": "gemini/%s" instead',
      parsed.gemini_model
    );
    return `gemini/${parsed.gemini_model}`;
  }
  return DEFAULTS.llm_model;
}

function loadConfigFile(configPath: string): ConfigFile {
  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`Failed to read config file: ${configPath}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  const merged: ConfigFile = {
    home_building_ids: (parsed.home_building_ids as number[] | undefined) ?? DEFAULTS.home_building_ids,
    discount_threshold: (parsed.discount_threshold as number | undefined) ?? DEFAULTS.discount_threshold,
    lot_fee: (parsed.lot_fee as number | undefined) ?? DEFAULTS.lot_fee,
    buyers_premium_rate: (parsed.buyers_premium_rate as number | undefined) ?? DEFAULTS.buyers_premium_rate,
    min_ebay_comps: (parsed.min_ebay_comps as number | undefined) ?? DEFAULTS.min_ebay_comps,
    location_tiers: {
      transfer: {
        extra_cost:
          (parsed.location_tiers as LocationTiers | undefined)?.transfer?.extra_cost ??
          DEFAULTS.location_tiers.transfer.extra_cost,
      },
      remote: {
        extra_cost:
          (parsed.location_tiers as LocationTiers | undefined)?.remote?.extra_cost ??
          DEFAULTS.location_tiers.remote.extra_cost,
      },
    },
    manual_review_conditions:
      (parsed.manual_review_conditions as string[] | undefined) ?? DEFAULTS.manual_review_conditions,
    llm_model: resolveModel(parsed),
  };

  return merged;
}

function loadEnv(): AppConfig["env"] {
  const get = (key: string): string => Bun.env[key] ?? "";
  return {
    ebayAppId: get("EBAY_APP_ID"),
    ebayAppSecret: get("EBAY_APP_SECRET"),
    geminiApiKey: get("GEMINI_API_KEY"),
    openaiApiKey: get("OPENAI_API_KEY"),
  };
}

export function parseCliOverrides(args: string[]): CliOverrides {
  const overrides: CliOverrides = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      overrides.force = true;
    } else if (arg === "--dry-run") {
      overrides.dryRun = true;
    } else if (arg === "--threshold") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--threshold requires a numeric value");
      }
      const val = Number(next);
      if (isNaN(val) || val <= 0 || val >= 1) {
        throw new Error("--threshold must be a number between 0 and 1 (exclusive)");
      }
      overrides.threshold = val;
      i++;
    } else if (arg === "--model") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--model requires a provider/model value (e.g. openai/gpt-4o-mini)");
      }
      if (!/^[a-z]+\/.+$/.test(next)) {
        throw new Error('--model must be in "provider/model-name" format (e.g. "openai/gpt-4o-mini")');
      }
      overrides.model = next;
      i++;
    }
  }

  return overrides;
}

export function loadConfig(cliArgs: string[] = [], projectRoot?: string): AppConfig {
  const root = projectRoot ?? process.cwd();
  const configPath = join(root, "config.json");

  const fileConfig = loadConfigFile(configPath);
  const cli = parseCliOverrides(cliArgs);

  // CLI --threshold overrides config file discount_threshold
  if (cli.threshold !== undefined) {
    fileConfig.discount_threshold = cli.threshold;
  }

  // CLI --model overrides config file llm_model
  if (cli.model !== undefined) {
    fileConfig.llm_model = cli.model;
  }

  const errors = validateConfig(fileConfig);
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return {
    ...fileConfig,
    env: loadEnv(),
    cli,
  };
}

export function validateTelegramEnv(): { token: string; allowedUserId: number } {
  const token = Bun.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  const allowedUserIdStr = Bun.env.TELEGRAM_ALLOWED_USER_ID;
  if (!allowedUserIdStr) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID environment variable is required");
  }

  const allowedUserId = Number(allowedUserIdStr);
  if (isNaN(allowedUserId)) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID must be a numeric user ID");
  }

  return { token, allowedUserId };
}

export { DEFAULTS };
