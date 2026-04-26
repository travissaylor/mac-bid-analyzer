import { describe, expect, test, spyOn } from "bun:test";
import { loadConfig, parseCliOverrides } from "./config";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mac-bid-config-test-"));
}

describe("loadConfig", () => {
  test("returns defaults when config.json is missing", () => {
    const dir = makeTempDir();
    const config = loadConfig([], dir);
    expect(config.discount_threshold).toBe(0.3);
    expect(config.lot_fee).toBe(3.0);
    expect(config.buyers_premium_rate).toBe(0.15);
    expect(config.min_ebay_comps).toBe(5);
    expect(config.home_building_ids).toEqual([15, 16, 6, 1]);
    expect(config.location_tiers.transfer.extra_cost).toBe(10);
    expect(config.location_tiers.remote.extra_cost).toBe(25);
    expect(config.manual_review_conditions).toEqual(["USED", "SALVAGE", "DAMAGED"]);
    rmSync(dir, { recursive: true });
  });

  test("reads values from config.json", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ discount_threshold: 0.4, lot_fee: 5 })
    );
    const config = loadConfig([], dir);
    expect(config.discount_threshold).toBe(0.4);
    expect(config.lot_fee).toBe(5);
    // defaults for unspecified fields
    expect(config.min_ebay_comps).toBe(5);
    rmSync(dir, { recursive: true });
  });

  test("throws on invalid JSON", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "config.json"), "not json{");
    expect(() => loadConfig([], dir)).toThrow("Invalid JSON");
    rmSync(dir, { recursive: true });
  });

  test("throws on invalid config values", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ discount_threshold: 1.5 })
    );
    expect(() => loadConfig([], dir)).toThrow("Invalid configuration");
    rmSync(dir, { recursive: true });
  });

  test("CLI --threshold overrides config file", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ discount_threshold: 0.3 })
    );
    const config = loadConfig(["--threshold", "0.5"], dir);
    expect(config.discount_threshold).toBe(0.5);
    expect(config.cli.threshold).toBe(0.5);
    rmSync(dir, { recursive: true });
  });

  test("CLI --force flag is parsed", () => {
    const dir = makeTempDir();
    const config = loadConfig(["--force"], dir);
    expect(config.cli.force).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("CLI --dry-run flag is parsed", () => {
    const dir = makeTempDir();
    const config = loadConfig(["--dry-run"], dir);
    expect(config.cli.dryRun).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("env values are loaded", () => {
    const dir = makeTempDir();
    const config = loadConfig([], dir);
    expect(typeof config.env.ebayAppId).toBe("string");
    expect(typeof config.env.ebayAppSecret).toBe("string");
    expect(typeof config.env.geminiApiKey).toBe("string");
    expect(typeof config.env.openaiApiKey).toBe("string");
    rmSync(dir, { recursive: true });
  });

  test("defaults llm_model to gemini/gemini-3.1-flash-lite-preview", () => {
    const dir = makeTempDir();
    const config = loadConfig([], dir);
    expect(config.llm_model).toBe("gemini/gemini-3.1-flash-lite-preview");
    rmSync(dir, { recursive: true });
  });

  test("reads llm_model from config", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ llm_model: "gemini/gemini-2.0-flash" })
    );
    const config = loadConfig([], dir);
    expect(config.llm_model).toBe("gemini/gemini-2.0-flash");
    rmSync(dir, { recursive: true });
  });

  test("migrates gemini_model to llm_model with deprecation warning", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ gemini_model: "gemini-3.1-flash-lite-preview" })
    );
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const config = loadConfig([], dir);
    expect(config.llm_model).toBe("gemini/gemini-3.1-flash-lite-preview");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
      "gemini-3.1-flash-lite-preview"
    );
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true });
  });

  test("llm_model takes precedence over gemini_model", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ llm_model: "openai/gpt-4o-mini", gemini_model: "gemini-2.0-flash" })
    );
    const config = loadConfig([], dir);
    expect(config.llm_model).toBe("openai/gpt-4o-mini");
    rmSync(dir, { recursive: true });
  });

  test("rejects invalid llm_model format", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ llm_model: "just-a-model-name" })
    );
    expect(() => loadConfig([], dir)).toThrow("provider/model-name");
    rmSync(dir, { recursive: true });
  });

  test("rejects unsupported provider in llm_model", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ llm_model: "anthropic/claude-3" })
    );
    expect(() => loadConfig([], dir)).toThrow('not supported');
    rmSync(dir, { recursive: true });
  });
});

describe("parseCliOverrides", () => {
  test("throws when --threshold has no value", () => {
    expect(() => parseCliOverrides(["--threshold"])).toThrow("--threshold requires a numeric value");
  });

  test("throws when --threshold value is out of range", () => {
    expect(() => parseCliOverrides(["--threshold", "0"])).toThrow("between 0 and 1");
    expect(() => parseCliOverrides(["--threshold", "1"])).toThrow("between 0 and 1");
  });

  test("parses multiple flags", () => {
    const result = parseCliOverrides(["--force", "--dry-run", "--threshold", "0.25"]);
    expect(result.force).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.threshold).toBe(0.25);
  });

  test("parses --model flag", () => {
    const result = parseCliOverrides(["--model", "gemini/gemini-2.5-flash"]);
    expect(result.model).toBe("gemini/gemini-2.5-flash");
  });

  test("throws when --model has no value", () => {
    expect(() => parseCliOverrides(["--model"])).toThrow("--model requires a provider/model value");
  });

  test("throws when --model value is missing slash", () => {
    expect(() => parseCliOverrides(["--model", "gpt-4o-mini"])).toThrow('provider/model-name" format');
  });

  test("--model overrides config llm_model", () => {
    const dir = makeTempDir();
    const config = loadConfig(["--model", "gemini/gemini-2.5-flash"], dir);
    expect(config.llm_model).toBe("gemini/gemini-2.5-flash");
    rmSync(dir, { recursive: true });
  });
});
