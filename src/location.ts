import type { AppConfig } from "./config";

const MACBID_BUILDINGS_URL = "https://api.macdiscount.com/buildings";

export interface MacBidBuilding {
  id: number;
  name: string;
  sales_tax: number;
  transfer_destinations: string | null;
}

export type LocationTier = "home" | "transfer" | "remote";

export interface LocationInfo {
  tier: LocationTier;
  extraCost: number;
  salesTaxRate: number;
}

interface BuildingsCache {
  buildings: MacBidBuilding[];
  homeBuildingIds: Set<number>;
  transferBuildingIds: Set<number>;
}

let buildingsCache: BuildingsCache | null = null;

export function clearBuildingsCache(): void {
  buildingsCache = null;
}

export async function fetchBuildings(): Promise<MacBidBuilding[]> {
  const response = await fetch(MACBID_BUILDINGS_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch buildings: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Invalid buildings response: expected an array");
  }

  return data as MacBidBuilding[];
}

export function deriveTransferBuildingIds(
  buildings: MacBidBuilding[],
  homeBuildingIds: number[]
): Set<number> {
  const homeSet = new Set(homeBuildingIds);
  const transferIds = new Set<number>();

  for (const building of buildings) {
    if (!homeSet.has(building.id)) continue;
    if (!building.transfer_destinations) continue;

    const destinations = building.transfer_destinations
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    for (const destId of destinations) {
      if (!homeSet.has(destId)) {
        transferIds.add(destId);
      }
    }
  }

  return transferIds;
}

export async function loadBuildings(config: AppConfig): Promise<BuildingsCache> {
  if (buildingsCache) return buildingsCache;

  const buildings = await fetchBuildings();
  const homeBuildingIds = new Set(config.home_building_ids);
  const transferBuildingIds = deriveTransferBuildingIds(buildings, config.home_building_ids);

  buildingsCache = { buildings, homeBuildingIds, transferBuildingIds };
  return buildingsCache;
}

export function getLocationInfo(
  cache: BuildingsCache,
  buildingId: number,
  config: AppConfig
): LocationInfo {
  const building = cache.buildings.find((b) => b.id === buildingId);
  const salesTaxRate = building?.sales_tax ?? 0;

  if (cache.homeBuildingIds.has(buildingId)) {
    return { tier: "home", extraCost: 0, salesTaxRate };
  }

  if (cache.transferBuildingIds.has(buildingId)) {
    return {
      tier: "transfer",
      extraCost: config.location_tiers.transfer.extra_cost,
      salesTaxRate,
    };
  }

  return {
    tier: "remote",
    extraCost: config.location_tiers.remote.extra_cost,
    salesTaxRate,
  };
}
