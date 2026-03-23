import { describe, expect, test } from "bun:test";
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
    expect(config.circuit_breaker_threshold).toBe(5);
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
    // ntfyUrl defaults when env var not set
    expect(config.env.ntfyUrl).toBe("http://192.168.68.53:2586/mac-bid-alerts");
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
});
