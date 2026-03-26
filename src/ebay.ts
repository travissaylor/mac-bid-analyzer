const EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export type SearchStrategy = "upc" | "llm" | "llm-broad";

export interface EbayPriceResult {
  median: number;
  low: number;
  high: number;
  count: number;
  searchQuery: string;
  strategy: SearchStrategy;
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

export async function searchEbayWithQuery(
  token: string,
  query: string,
  options: {
    gtin?: string;
    conditionFilter?: string | null;
    strategy: SearchStrategy;
    strategyLabel: string;
  },
): Promise<EbayPriceResult> {
  const isGtinSearch = !!options.gtin;

  const params = new URLSearchParams({
    q: query,
    filter: buildFilter(!isGtinSearch, options.conditionFilter ?? null),
    limit: "50",
  });

  if (isGtinSearch) {
    params.set("gtin", options.gtin!);
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
      searchQuery: options.strategyLabel,
      strategy: options.strategy,
    };
  }

  prices.sort((a, b) => a - b);

  return {
    median: calculateMedian(prices),
    low: prices[0],
    high: prices[prices.length - 1],
    count: prices.length,
    searchQuery: options.strategyLabel,
    strategy: options.strategy,
  };
}

/**
 * @deprecated Use searchEbayCascade instead. Kept for backward compatibility.
 */
export async function searchEbaySoldListings(
  token: string,
  upc: string | null,
  productName: string,
  condition: string
): Promise<EbayPriceResult | null> {
  const useNameSearch = !upc || isAsin(upc);
  const query = useNameSearch ? productName : upc;
  const strategyLabel = useNameSearch ? `llm:${productName}` : `upc:${upc}`;
  const strategy: SearchStrategy = useNameSearch ? "llm" : "upc";
  const conditionFilter = mapConditionToEbayFilter(condition);

  return searchEbayWithQuery(token, query, {
    gtin: useNameSearch ? undefined : upc!,
    conditionFilter: conditionFilter.ebayFilter,
    strategy,
    strategyLabel,
  });
}

/**
 * Generate a broader fallback query by keeping only the first few terms
 * (typically brand + product type, dropping specific model/specs).
 */
export function broadenQuery(query: string): string | null {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return null;
  // Keep roughly half the words, minimum 2
  const keepCount = Math.max(2, Math.ceil(words.length / 2));
  const broad = words.slice(0, keepCount).join(" ");
  return broad === query ? null : broad;
}

export interface CascadeOptions {
  token: string;
  upc: string | null;
  llmQuery: string;
  condition: string;
  minComps: number;
}

export interface CascadeResult {
  result: EbayPriceResult;
  cascadeDepth: number;
}

/**
 * Try progressively broader eBay searches until min_ebay_comps is met.
 * Cascade order: (1) UPC/GTIN, (2) LLM query, (3) Broadened LLM query.
 * Stops at the first step that meets the threshold.
 */
export async function searchEbayCascade(
  options: CascadeOptions,
  logger: (msg: string) => void = () => {},
): Promise<CascadeResult> {
  const { token, upc, llmQuery, condition, minComps } = options;
  const conditionFilter = mapConditionToEbayFilter(condition);
  let cascadeDepth = 0;
  let bestResult: EbayPriceResult | null = null;

  // Step 1: UPC/GTIN search (if available and not ASIN)
  if (upc && !isAsin(upc)) {
    cascadeDepth = 1;
    logger(`Cascade step 1: UPC search (${upc})`);
    const result = await searchEbayWithQuery(token, upc, {
      gtin: upc,
      conditionFilter: conditionFilter.ebayFilter,
      strategy: "upc",
      strategyLabel: `upc:${upc}`,
    });
    if (result.count >= minComps) {
      logger(`Cascade step 1: found ${result.count} comps (sufficient)`);
      return { result, cascadeDepth };
    }
    logger(`Cascade step 1: found ${result.count} comps (insufficient, need ${minComps})`);
    bestResult = result;
  }

  // Step 2: LLM-generated query with condition filter
  cascadeDepth = 2;
  logger(`Cascade step 2: LLM query "${llmQuery}"`);
  const llmResult = await searchEbayWithQuery(token, llmQuery, {
    conditionFilter: conditionFilter.ebayFilter,
    strategy: "llm",
    strategyLabel: `llm:${llmQuery}`,
  });
  if (llmResult.count >= minComps) {
    logger(`Cascade step 2: found ${llmResult.count} comps (sufficient)`);
    return { result: llmResult, cascadeDepth };
  }
  logger(`Cascade step 2: found ${llmResult.count} comps (insufficient, need ${minComps})`);
  if (!bestResult || llmResult.count > bestResult.count) {
    bestResult = llmResult;
  }

  // Step 3: Broadened LLM query with condition filter
  const broadQuery = broadenQuery(llmQuery);
  if (broadQuery) {
    cascadeDepth = 3;
    logger(`Cascade step 3: broad query "${broadQuery}"`);
    const broadResult = await searchEbayWithQuery(token, broadQuery, {
      conditionFilter: conditionFilter.ebayFilter,
      strategy: "llm-broad",
      strategyLabel: `llm-broad:${broadQuery}`,
    });
    if (broadResult.count >= minComps) {
      logger(`Cascade step 3: found ${broadResult.count} comps (sufficient)`);
      return { result: broadResult, cascadeDepth };
    }
    logger(`Cascade step 3: found ${broadResult.count} comps (insufficient, need ${minComps})`);
    if (!bestResult || broadResult.count > bestResult.count) {
      bestResult = broadResult;
    }
  }

  // Return the best result we found across all steps
  logger(`Cascade exhausted: returning best result with ${bestResult!.count} comps`);
  return { result: bestResult!, cascadeDepth };
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
  condition: string,
  options?: {
    minComps?: number;
    logger?: (msg: string) => void;
  },
): Promise<CascadeResult | null> {
  try {
    const token = await getEbayToken(appId, appSecret);
    return await searchEbayCascade(
      {
        token,
        upc,
        llmQuery: productName,
        condition,
        minComps: options?.minComps ?? 5,
      },
      options?.logger,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] eBay API error: ${message}`);
    return null;
  }
}
