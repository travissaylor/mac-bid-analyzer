import { describe, expect, it } from "bun:test";
import { calculateMaxBid, calculateDealScore } from "./estimate";

describe("calculateMaxBid", () => {
  it("should calculate max bid correctly for home location", () => {
    // Example from PRICING.md: eBay median $55, tax 6%, home ($0 extra)
    // target = 55 * 0.7 = 38.50
    // max = (38.50 - 3.00 - 0) / (1 + 0.15 + 0.06) = 35.50 / 1.21 = 29.34
    const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 0);
    expect(result).toBeCloseTo(29.34, 1);
  });

  it("should calculate max bid correctly for transfer location", () => {
    // target = 55 * 0.7 = 38.50
    // max = (38.50 - 3.00 - 10.00) / 1.21 = 25.50 / 1.21 = 21.07
    const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 10);
    expect(result).toBeCloseTo(21.07, 1);
  });

  it("should calculate max bid correctly for remote location", () => {
    // target = 55 * 0.7 = 38.50
    // max = (38.50 - 3.00 - 25.00) / 1.21 = 10.50 / 1.21 = 8.68
    const result = calculateMaxBid(55.0, 0.3, 3.0, 0.15, 0.06, 25);
    expect(result).toBeCloseTo(8.68, 1);
  });

  it("should return negative when fees exceed target", () => {
    // Very low eBay price, high fees
    const result = calculateMaxBid(5.0, 0.3, 3.0, 0.15, 0.06, 25);
    expect(result).toBeLessThan(0);
  });

  it("should handle zero eBay median", () => {
    const result = calculateMaxBid(0, 0.3, 3.0, 0.15, 0.06, 0);
    expect(result).toBeLessThan(0);
  });
});

describe("calculateDealScore", () => {
  it("should calculate positive deal score when bid is below max", () => {
    // max=30, bid=10 => (30-10)/30*100 = 66.67%
    expect(calculateDealScore(30, 10)).toBeCloseTo(66.67, 1);
  });

  it("should calculate negative deal score when bid exceeds max", () => {
    // max=20, bid=25 => (20-25)/20*100 = -25%
    expect(calculateDealScore(20, 25)).toBeCloseTo(-25, 1);
  });

  it("should return zero when max bid is zero", () => {
    expect(calculateDealScore(0, 10)).toBe(0);
  });

  it("should return zero when max bid is negative", () => {
    expect(calculateDealScore(-5, 10)).toBe(0);
  });

  it("should return 100% when current bid is 0", () => {
    expect(calculateDealScore(30, 0)).toBeCloseTo(100, 1);
  });
});
