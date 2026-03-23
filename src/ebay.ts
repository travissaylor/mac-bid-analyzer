const EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export interface EbayPriceResult {
  median: number;
  low: number;
  high: number;
  count: number;
  searchQuery: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function clearTokenCache(): void {
  cachedToken = null;
}

export async function getEbayToken(appId: string, appSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  const response = await fetch(EBAY_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.accessToken;
}

function isAsin(upc: string): boolean {
  return upc.length === 10 && upc.startsWith("B0");
}

interface ConditionFilter {
  ebayFilter: string | null;
}

function mapConditionToEbayFilter(condition: string): ConditionFilter {
  const upper = condition.toUpperCase();
  switch (upper) {
    case "NEW":
      return { ebayFilter: "conditionIds:{1000}" };
    case "LIKE NEW":
      return { ebayFilter: "conditionIds:{1500}" };
    case "OPEN BOX":
      return { ebayFilter: "conditionIds:{1500}" };
    default:
      return { ebayFilter: null };
  }
}

interface EbaySearchItem {
  price?: { value?: string };
}

interface EbaySearchResponse {
  total: number;
  itemSummaries?: EbaySearchItem[];
}

export async function searchEbaySoldListings(
  token: string,
  upc: string | null,
  productName: string,
  condition: string
): Promise<EbayPriceResult | null> {
  const useNameSearch = !upc || isAsin(upc);
  const query = useNameSearch ? productName : upc;
  const searchQuery = useNameSearch ? `name:${productName}` : `upc:${upc}`;

  const conditionFilter = mapConditionToEbayFilter(condition);

  const params = new URLSearchParams({
    q: query,
    filter: buildFilter(useNameSearch, conditionFilter.ebayFilter),
    limit: "50",
  });

  if (!useNameSearch) {
    params.set("gtin", upc!);
  }

  const url = `${EBAY_SEARCH_URL}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as EbaySearchResponse;
  const items = data.itemSummaries ?? [];

  const prices = items
    .map((item) => parseFloat(item.price?.value ?? ""))
    .filter((p) => !isNaN(p) && p > 0);

  if (prices.length === 0) {
    return {
      median: 0,
      low: 0,
      high: 0,
      count: 0,
      searchQuery,
    };
  }

  prices.sort((a, b) => a - b);

  return {
    median: calculateMedian(prices),
    low: prices[0],
    high: prices[prices.length - 1],
    count: prices.length,
    searchQuery,
  };
}

function buildFilter(isNameSearch: boolean, conditionFilter: string | null): string {
  const filters: string[] = ["buyingOptions:{FIXED_PRICE|AUCTION}"];

  if (conditionFilter) {
    filters.push(conditionFilter);
  }

  if (isNameSearch) {
    filters.push("priceCurrency:USD");
  }

  return filters.join(",");
}

function calculateMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export async function searchEbay(
  appId: string,
  appSecret: string,
  upc: string | null,
  productName: string,
  condition: string
): Promise<EbayPriceResult | null> {
  try {
    const token = await getEbayToken(appId, appSecret);
    return await searchEbaySoldListings(token, upc, productName, condition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] eBay API error: ${message}`);
    return null;
  }
}
