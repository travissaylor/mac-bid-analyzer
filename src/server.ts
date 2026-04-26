import {
  openDatabase,
  getItemByLotId,
  getItemByAuctionAndLotNumber,
  getItemByLotNumber,
} from "./db";
import type { AnalyzedItem } from "./shared/types";
import { parseLotId, resolveLotId, analyzeItem } from "./analyze";
import { loadConfig } from "./config";
import { clearBuildingsCache } from "./location";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

function validateAuth(request: Request): boolean {
  const token = Bun.env.API_TOKEN;
  if (!token) {
    log("Warning: API_TOKEN not set — all requests will be rejected");
    return false;
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  return match[1] === token;
}

function normalizeFeedback(
  body: Record<string, unknown>
): { userFeedback: string | null | undefined; forced: boolean } {
  if (!("user_feedback" in body)) {
    return { userFeedback: undefined, forced: false };
  }
  const v = body.user_feedback;
  if (v === null || v === "") {
    return { userFeedback: null, forced: true };
  }
  if (typeof v === "string") {
    return { userFeedback: v, forced: true };
  }
  throw new Error("user_feedback must be a string or null");
}

async function handleAnalyze(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.input || typeof body.input !== "string") {
    return errorResponse("Missing required field: input", 400);
  }

  let userFeedback: string | null | undefined;
  let feedbackForced: boolean;
  try {
    const normalized = normalizeFeedback(body);
    userFeedback = normalized.userFeedback;
    feedbackForced = normalized.forced;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message, 400);
  }

  try {
    const parsedLot = parseLotId(body.input);
    const config = loadConfig();
    clearBuildingsCache();

    const resolved = await resolveLotId(parsedLot);
    log(`API: Analyzing lot ${resolved.lotId}...`);
    const result = await analyzeItem(resolved.lotId, config, {
      force: Boolean(body.force) || feedbackForced,
      ssrData: resolved.ssrData,
      userFeedback,
    });

    return jsonResponse(result.item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`API analyze error: ${message}`);
    return errorResponse(message, 500);
  }
}

function handleGetLot(lotIdStr: string): Response {
  const lotId = Number(lotIdStr);
  if (isNaN(lotId) || lotId <= 0) {
    return errorResponse("Invalid lot ID", 400);
  }

  const db = openDatabase();
  try {
    const item: AnalyzedItem | null = getItemByLotId(db, lotId);
    if (!item) {
      return errorResponse("Not found", 404);
    }
    return jsonResponse(item);
  } finally {
    db.close();
  }
}

function handleGetLotByAuctionLot(url: URL): Response {
  const auctionIdStr = url.searchParams.get("auction_id");
  const lotNumber = url.searchParams.get("lot_number");
  if (!lotNumber) {
    return errorResponse("Missing lot_number", 400);
  }

  const db = openDatabase();
  try {
    let item: AnalyzedItem | null = null;
    if (auctionIdStr) {
      const auctionId = Number(auctionIdStr);
      if (isNaN(auctionId) || auctionId <= 0) {
        return errorResponse("Invalid auction_id", 400);
      }
      item = getItemByAuctionAndLotNumber(db, auctionId, lotNumber);
    } else {
      item = getItemByLotNumber(db, lotNumber);
    }
    if (!item) {
      return errorResponse("Not found", 404);
    }
    return jsonResponse(item);
  } finally {
    db.close();
  }
}

/** The core request handler, exported for direct testing without a live server. */
export function handleRequest(request: Request): Response | Promise<Response> {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Auth check for all non-OPTIONS requests
  if (!validateAuth(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // POST /api/analyze
  if (request.method === "POST" && url.pathname === "/api/analyze") {
    return handleAnalyze(request);
  }

  // GET /api/lot/:lotId
  const lotMatch = url.pathname.match(/^\/api\/lot\/(\d+)$/);
  if (request.method === "GET" && lotMatch) {
    return handleGetLot(lotMatch[1]);
  }

  // GET /api/lot?auction_id=X&lot_number=Y
  if (request.method === "GET" && url.pathname === "/api/lot") {
    return handleGetLotByAuctionLot(url);
  }

  return errorResponse("Not found", 404);
}

export function startServer(port?: number): ReturnType<typeof Bun.serve> {
  const listenPort = port ?? (Number(Bun.env.PORT) || 3000);

  const server = Bun.serve({
    port: listenPort,
    fetch: handleRequest,
  });

  log(`Server listening on http://localhost:${listenPort}`);
  return server;
}
