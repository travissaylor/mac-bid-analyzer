import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  clearBuildingsCache,
  deriveTransferBuildingIds,
  fetchBuildings,
  getLocationInfo,
  loadBuildings,
  type MacBidBuilding,
} from "./location";
import type { AppConfig } from "./config";

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    home_building_ids: [1, 6],
    discount_threshold: 0.3,
    lot_fee: 3.0,
    buyers_premium_rate: 0.15,
    min_ebay_comps: 5,
    location_tiers: {
      transfer: { extra_cost: 10 },
      remote: { extra_cost: 25 },
    },
    manual_review_conditions: ["USED", "SALVAGE", "DAMAGED"],
    circuit_breaker_threshold: 5,
    env: {
      macbidEmail: "",
      macbidPassword: "",
      ebayAppId: "",
      ebayAppSecret: "",
      geminiApiKey: "",
      ntfyUrl: "",
    },
    cli: {},
    ...overrides,
  };
}

const MOCK_BUILDINGS: MacBidBuilding[] = [
  { id: 1, name: "Robinson", sales_tax: 0.06, transfer_destinations: "2,3" },
  { id: 2, name: "Cranberry", sales_tax: 0.06, transfer_destinations: "1" },
  { id: 3, name: "Monroeville", sales_tax: 0.06, transfer_destinations: "1" },
  { id: 6, name: "Washington", sales_tax: 0.06, transfer_destinations: "2" },
  { id: 10, name: "Columbus", sales_tax: 0.0725, transfer_destinations: null },
  { id: 15, name: "Remote City", sales_tax: 0.05, transfer_destinations: "10" },
];

describe("deriveTransferBuildingIds", () => {
  it("collects transfer destinations from home buildings", () => {
    const result = deriveTransferBuildingIds(MOCK_BUILDINGS, [1, 6]);
    expect(result).toEqual(new Set([2, 3]));
  });

  it("does not include home buildings as transfer", () => {
    // Building 1 has transfer_destinations "2,3" — building 1 itself should not be in transfer set
    // Building 6 has transfer_destinations "2" — 2 is already there
    const result = deriveTransferBuildingIds(MOCK_BUILDINGS, [1, 6]);
    expect(result.has(1)).toBe(false);
    expect(result.has(6)).toBe(false);
  });

  it("handles buildings with no transfer_destinations", () => {
    const result = deriveTransferBuildingIds(MOCK_BUILDINGS, [10]);
    expect(result.size).toBe(0);
  });

  it("handles empty home_building_ids", () => {
    const result = deriveTransferBuildingIds(MOCK_BUILDINGS, []);
    expect(result.size).toBe(0);
  });

  it("deduplicates transfer destinations across home buildings", () => {
    // Both building 1 and 6 can transfer to building 2
    const result = deriveTransferBuildingIds(MOCK_BUILDINGS, [1, 6]);
    expect(result.has(2)).toBe(true);
    // Set inherently deduplicates
    expect([...result].filter((id) => id === 2).length).toBe(1);
  });
});

describe("getLocationInfo", () => {
  const config = makeConfig({ home_building_ids: [1, 6] });
  const cache = {
    buildings: MOCK_BUILDINGS,
    homeBuildingIds: new Set([1, 6]),
    transferBuildingIds: new Set([2, 3]),
  };

  it("returns home tier for home buildings", () => {
    const info = getLocationInfo(cache, 1, config);
    expect(info.tier).toBe("home");
    expect(info.extraCost).toBe(0);
    expect(info.salesTaxRate).toBe(0.06);
  });

  it("returns transfer tier for transfer-eligible buildings", () => {
    const info = getLocationInfo(cache, 2, config);
    expect(info.tier).toBe("transfer");
    expect(info.extraCost).toBe(10);
    expect(info.salesTaxRate).toBe(0.06);
  });

  it("returns remote tier for other buildings", () => {
    const info = getLocationInfo(cache, 10, config);
    expect(info.tier).toBe("remote");
    expect(info.extraCost).toBe(25);
    expect(info.salesTaxRate).toBe(0.0725);
  });

  it("returns remote tier for unknown building IDs", () => {
    const info = getLocationInfo(cache, 999, config);
    expect(info.tier).toBe("remote");
    expect(info.extraCost).toBe(25);
    expect(info.salesTaxRate).toBe(0);
  });

  it("uses configurable transfer cost", () => {
    const customConfig = makeConfig({
      home_building_ids: [1, 6],
      location_tiers: {
        transfer: { extra_cost: 15 },
        remote: { extra_cost: 30 },
      },
    });
    const info = getLocationInfo(cache, 2, customConfig);
    expect(info.extraCost).toBe(15);
  });

  it("uses configurable remote cost", () => {
    const customConfig = makeConfig({
      home_building_ids: [1, 6],
      location_tiers: {
        transfer: { extra_cost: 15 },
        remote: { extra_cost: 30 },
      },
    });
    const info = getLocationInfo(cache, 10, customConfig);
    expect(info.extraCost).toBe(30);
  });
});

describe("fetchBuildings", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetches and returns buildings array", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_BUILDINGS), { status: 200 })
    );

    const result = await fetchBuildings();
    expect(result).toEqual(MOCK_BUILDINGS);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.macdiscount.com/buildings");
  });

  it("throws on non-OK response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );

    await expect(fetchBuildings()).rejects.toThrow("Failed to fetch buildings: 404 Not Found");
  });

  it("throws on non-array response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad" }), { status: 200 })
    );

    await expect(fetchBuildings()).rejects.toThrow("Invalid buildings response: expected an array");
  });
});

describe("loadBuildings", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearBuildingsCache();
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    clearBuildingsCache();
  });

  it("fetches buildings and derives transfer IDs", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_BUILDINGS), { status: 200 })
    );

    const config = makeConfig({ home_building_ids: [1, 6] });
    const cache = await loadBuildings(config);

    expect(cache.buildings).toEqual(MOCK_BUILDINGS);
    expect(cache.homeBuildingIds).toEqual(new Set([1, 6]));
    expect(cache.transferBuildingIds).toEqual(new Set([2, 3]));
  });

  it("caches buildings on subsequent calls", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_BUILDINGS), { status: 200 })
    );

    const config = makeConfig({ home_building_ids: [1, 6] });
    await loadBuildings(config);
    await loadBuildings(config);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
