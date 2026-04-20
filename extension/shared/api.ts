// Pure HTTP contract to the analyzer backend.
// No chrome.* calls — the entry point injects a `FetchFn` that knows how to
// route requests (e.g. through a service-worker proxy to dodge mixed-content
// blocking when the backend is plain HTTP).

import type { AnalyzedItem, FetchFn, LotInfo, NoTokenError } from "./types";

/** Build the standard "API token not configured" error. */
export function noTokenError(): NoTokenError {
  const err = new Error("API token not configured") as NoTokenError;
  err.code = "NO_TOKEN";
  return err;
}

/**
 * Look up cached analysis for a lot.
 *
 * Prefer lookup by (auction_id, lot_number) since the URL's lot id may be an
 * alphanumeric lot number (e.g. "3173X") rather than the numeric internal
 * lot_id that is the DB primary key. Only includes auction_id when it's
 * numeric — auction "codes" like "WAB2604-19-A1" aren't stored.
 *
 * - Throws `noTokenError()` when `apiToken` is empty.
 * - Throws "Invalid API token" on 401.
 * - Throws "Backend error (status)" on any other non-OK status.
 * - Returns null on 404 (not cached) or when no usable lookup key is present.
 */
export async function fetchCached(
  lotInfo: LotInfo,
  baseUrl: string,
  apiToken: string,
  fetchFn: FetchFn
): Promise<AnalyzedItem | null> {
  if (!apiToken) throw noTokenError();

  let url: string;
  const lotNumber = lotInfo.lotNumber || lotInfo.lotId;
  if (lotNumber) {
    const params = new URLSearchParams({ lot_number: String(lotNumber) });
    if (lotInfo.auctionId && /^\d+$/.test(String(lotInfo.auctionId))) {
      params.set("auction_id", String(lotInfo.auctionId));
    }
    url = `${baseUrl}/api/lot?${params.toString()}`;
  } else if (/^\d+$/.test(String(lotInfo.lotId))) {
    url = `${baseUrl}/api/lot/${lotInfo.lotId}`;
  } else {
    return null;
  }

  const resp = await fetchFn({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (resp.status === 404) return null;
  if (resp.status === 401) throw new Error("Invalid API token");
  if (!resp.ok) throw new Error(`Backend error (${resp.status})`);
  return resp.body as AnalyzedItem;
}

/** Options accepted by `postAnalyze`. */
export interface AnalyzeOpts {
  force?: boolean;
  /**
   * If the key is present (even if `null` or empty string), `user_feedback`
   * will be sent on the request. Use `undefined` (or omit) to leave it off.
   */
  userFeedback?: string | null;
}

/**
 * Trigger a fresh analysis on the backend.
 *
 * The body always includes `input` (the URL path or lot id), `force` when
 * truthy, and `user_feedback` when the caller passed the key explicitly
 * (matching the side-panel behavior of using `hasOwnProperty` to decide).
 */
export async function postAnalyze(
  lotInfo: LotInfo,
  opts: AnalyzeOpts,
  baseUrl: string,
  apiToken: string,
  fetchFn: FetchFn
): Promise<AnalyzedItem> {
  if (!apiToken) throw noTokenError();

  const body: Record<string, unknown> = {
    input: lotInfo.path || String(lotInfo.lotId),
  };
  if (opts.force) body.force = true;
  if (Object.prototype.hasOwnProperty.call(opts, "userFeedback")) {
    body.user_feedback = opts.userFeedback;
  }

  const resp = await fetchFn({
    url: `${baseUrl}/api/analyze`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 401) throw new Error("Invalid API token");
  if (!resp.ok) {
    const errMsg =
      (resp.body && typeof resp.body === "object" && "error" in resp.body
        ? String((resp.body as { error?: unknown }).error ?? "")
        : "") || `Backend error (${resp.status})`;
    throw new Error(errMsg);
  }
  return resp.body as AnalyzedItem;
}
