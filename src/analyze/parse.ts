/**
 * Parse a mac.bid URL or lot ID into a numeric internal lot ID.
 * Supported formats:
 *   https://mac.bid/auction/{auctionId}/lot/{lotNumber}
 *   https://www.mac.bid/auction/{auctionId}/lot/{lotNumber}
 *   {lotId} (bare numeric internal ID)
 *
 * For URLs with alphanumeric lot numbers (e.g. 2587T), fetches the page
 * to resolve the internal lot ID from SSR data.
 */
export function parseLotId(input: string): number | string {
  const trimmed = input.trim();

  // Bare numeric internal lot ID
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Full URL: /auction/{auctionId}/lot/{lotNumber}
  const auctionLot = trimmed.match(/\/auction\/([^/]+)\/lot\/([^/?\s]+)/);
  if (auctionLot) {
    const lotNumber = auctionLot[2];
    // If purely numeric, use directly
    if (/^\d+$/.test(lotNumber)) {
      return parseInt(lotNumber, 10);
    }
    // Alphanumeric lot number — return the full URL path for resolution
    return trimmed;
  }

  // /lot/{id} permalink (numeric only)
  const lotPermalink = trimmed.match(/\/lot\/(\d+)/);
  if (lotPermalink) {
    return parseInt(lotPermalink[1], 10);
  }

  throw new Error(`Cannot parse lot ID from input: ${input}`);
}

export interface ResolvedLot {
  lotId: number;
  /** Full lot data from SSR, available when resolved from a URL */
  ssrData?: Record<string, unknown>;
}

/**
 * Resolve a mac.bid URL to an internal numeric lot ID by fetching the
 * SSR page and extracting the ID from __NEXT_DATA__.
 * Returns both the ID and the full SSR lot data when available.
 */
export async function resolveLotId(input: string | number): Promise<ResolvedLot> {
  // Convert numeric ID to permalink URL so we always get SSR data
  const rawInput = typeof input === "number"
    ? `https://www.mac.bid/lot/${input}`
    : input;

  // Fetch the page and extract from __NEXT_DATA__
  const url = rawInput.startsWith("http") ? rawInput : `https://www.mac.bid${rawInput.startsWith("/") ? "" : "/"}${rawInput}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch lot page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const match = html.match(/id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    throw new Error("Could not find __NEXT_DATA__ in lot page");
  }

  const data = JSON.parse(match[1]);
  const pageProps = data?.props?.pageProps;
  const currentLot = pageProps?.activeLot ?? pageProps?.currentLot;
  const lotId = currentLot?.id;
  if (typeof lotId !== "number") {
    throw new Error("Could not extract lot ID from page data");
  }

  return { lotId, ssrData: currentLot };
}

export function isAsin(upc: string): boolean {
  return upc.length === 10 && upc.startsWith("B0");
}

export interface MacBidLotItem {
  id: number;
  auction_id: number;
  lot_number: string;
  product_name: string;
  upc: string | null;
  condition: string;
  retail_price: number | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  /** All image URLs extracted from SSR data. First is stock, rest are actual product photos. */
  image_urls: string[];
  /** True when only the stock image is available (no actual product photos). */
  stock_image_only: boolean;
  building_id: number | null;
  current_location_id: number | null;
  location: string | null;
  expected_close_date: string | null;
  is_open: boolean;
  current_bid: number;
  total_bids: number;
  watchers_count: number;
}

export const MACBID_LOT_URL = "https://api.macdiscount.com/map-bid/ddb/lot";

/** Known SSR field names that may contain an array of image URLs. */
const IMAGE_ARRAY_FIELDS = ["images", "product_images", "gallery", "photos", "lot_images", "image_urls"];

/**
 * Extract all image URLs from SSR/API data.
 * Searches known array fields, then falls back to the single image_url/stock_image_url.
 * Returns a deduplicated array of URL strings.
 */
export function extractImageUrls(data: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // Start with the stock/primary image so it is always index 0
  const primary = data.image_url as string | undefined;
  const stock = data.stock_image_url as string | undefined;
  const stockUrl = (typeof primary === "string" && primary.length > 0) ? primary
    : (typeof stock === "string" && stock.length > 0) ? stock
    : null;
  if (stockUrl) {
    urls.push(stockUrl);
  }

  // Add product photos from known array fields
  for (const field of IMAGE_ARRAY_FIELDS) {
    const value = data[field];
    if (Array.isArray(value) && value.length > 0) {
      for (const item of value) {
        if (typeof item === "string" && item.length > 0) {
          urls.push(item);
        } else if (item && typeof item === "object") {
          // Handle objects like { url: "..." } or { src: "..." } or { image_url: "..." }
          const obj = item as Record<string, unknown>;
          const candidate = (obj.url ?? obj.src ?? obj.image_url ?? obj.href) as string | undefined;
          if (typeof candidate === "string" && candidate.length > 0) {
            urls.push(candidate);
          }
        }
      }
      break;
    }
  }

  // Deduplicate while preserving order
  return [...new Set(urls)];
}

function parseLotData(data: Record<string, unknown>, lotId: number): MacBidLotItem {
  // building_id may be nested inside auction object (SSR data)
  const auction = data.auction as Record<string, unknown> | undefined;
  const buildingId = (data.building_id ?? auction?.building_id ?? null) as number | null;
  const locationName = (data.location ?? data.auction_location ?? auction?.location_name ?? null) as string | null;
  const imageUrls = extractImageUrls(data);

  return {
    id: (data.id ?? data.lot_id ?? lotId) as number,
    auction_id: (data.auction_id ?? 0) as number,
    lot_number: String(data.lot_number ?? ""),
    product_name: (data.product_name ?? data.title ?? "") as string,
    upc: (data.upc ?? null) as string | null,
    condition: (data.condition ?? data.condition_name ?? "UNKNOWN") as string,
    retail_price: (data.retail_price ?? null) as number | null,
    category: (data.category ?? data.category_name ?? null) as string | null,
    description: (data.description ?? null) as string | null,
    image_url: (data.image_url ?? data.stock_image_url ?? null) as string | null,
    image_urls: imageUrls,
    stock_image_only: imageUrls.length <= 1,
    building_id: buildingId,
    current_location_id: (data.current_location_id ?? data.location_id ?? null) as number | null,
    location: locationName,
    expected_close_date: (data.expected_close_date ?? data.end_time ?? null) as string | null,
    is_open: data.is_open !== undefined ? Boolean(data.is_open) : true,
    current_bid: Number(data.current_bid ?? 0),
    total_bids: Number(data.total_bids ?? 0),
    watchers_count: Number(data.watchers_count ?? 0),
  };
}

export async function fetchLotItem(lotId: number, ssrData?: Record<string, unknown>): Promise<MacBidLotItem> {
  // Use SSR data if available (richer than DDB endpoint)
  if (ssrData) {
    return parseLotData(ssrData, lotId);
  }

  const url = `${MACBID_LOT_URL}/${lotId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch lot ${lotId}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid lot response for lot ${lotId}`);
  }

  return parseLotData(data as Record<string, unknown>, lotId);
}
