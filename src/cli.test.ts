import { describe, test, expect } from "bun:test";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  test("no args returns help subcommand", () => {
    const result = parseArgs([]);
    expect(result.subcommand).toBe("help");
  });

  test("--help alone returns help subcommand", () => {
    const result = parseArgs(["--help"]);
    expect(result.subcommand).toBe("help");
    expect(result.flags.help).toBe(true);
  });

  test("analyze subcommand with lot ID", () => {
    const result = parseArgs(["analyze", "12345"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.input).toBe("12345");
  });

  test("analyze subcommand with URL", () => {
    const result = parseArgs(["analyze", "https://mac.bid/auction/XYZ/lot/12345"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.input).toBe("https://mac.bid/auction/XYZ/lot/12345");
  });

  test("analyze without input throws", () => {
    expect(() => parseArgs(["analyze"])).toThrow("analyze requires an input");
  });

  test("analyze --help does not require input", () => {
    const result = parseArgs(["analyze", "--help"]);
    expect(result.subcommand).toBe("analyze");
    expect(result.flags.help).toBe(true);
  });

  test("watchlist subcommand", () => {
    const result = parseArgs(["watchlist"]);
    expect(result.subcommand).toBe("watchlist");
  });

  test("results subcommand", () => {
    const result = parseArgs(["results"]);
    expect(result.subcommand).toBe("results");
  });

  test("results --open flag", () => {
    const result = parseArgs(["results", "--open"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.open).toBe(true);
  });

  test("results --deals flag", () => {
    const result = parseArgs(["results", "--deals"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.deals).toBe(true);
  });

  test("results --review flag", () => {
    const result = parseArgs(["results", "--review"]);
    expect(result.subcommand).toBe("results");
    expect(result.flags.review).toBe(true);
  });

  test("--force flag", () => {
    const result = parseArgs(["watchlist", "--force"]);
    expect(result.flags.force).toBe(true);
  });

  test("--dry-run flag", () => {
    const result = parseArgs(["watchlist", "--dry-run"]);
    expect(result.flags.dryRun).toBe(true);
  });

  test("--threshold flag with valid value", () => {
    const result = parseArgs(["analyze", "12345", "--threshold", "0.25"]);
    expect(result.flags.threshold).toBe(0.25);
  });

  test("--threshold without value throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--threshold"])).toThrow("--threshold requires a numeric value");
  });

  test("--threshold with invalid value throws", () => {
    expect(() => parseArgs(["analyze", "12345", "--threshold", "1.5"])).toThrow(
      "--threshold must be a number between 0 and 1"
    );
  });

  test("unknown subcommand throws", () => {
    expect(() => parseArgs(["foobar"])).toThrow("Unknown subcommand: foobar");
  });

  test("unknown option throws", () => {
    expect(() => parseArgs(["watchlist", "--unknown"])).toThrow("Unknown option: --unknown");
  });

  test("multiple flags combined", () => {
    const result = parseArgs(["watchlist", "--force", "--dry-run", "--threshold", "0.4"]);
    expect(result.subcommand).toBe("watchlist");
    expect(result.flags.force).toBe(true);
    expect(result.flags.dryRun).toBe(true);
    expect(result.flags.threshold).toBe(0.4);
  });
});
