import type { Database } from "bun:sqlite";
import {
  logError,
  recordCircuitBreakerFailure,
  resetCircuitBreaker,
  getTrippedBreakers,
  markBreakerNotified,
} from "./db";
import type { ErrorLogEntry, CircuitBreakerRow } from "./db";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export class CircuitBreakerTripped extends Error {
  constructor(
    public readonly errorType: string,
    public readonly consecutiveFailures: number,
    public readonly lastMessage: string
  ) {
    super(
      `Circuit breaker tripped: ${errorType} failed ${consecutiveFailures} consecutive times`
    );
    this.name = "CircuitBreakerTripped";
  }
}

/**
 * Classify an error into a type string for circuit breaker tracking.
 * Groups errors by their root cause (API, auth, etc.) rather than per-item.
 */
export function classifyError(error: Error): string {
  const msg = error.message.toLowerCase();

  if (msg.includes("firebase") || msg.includes("authenticate") || msg.includes("sign-in")) {
    return "auth";
  }
  if (msg.includes("ebay") || msg.includes("buy/browse")) {
    return "ebay_api";
  }
  if (msg.includes("gemini")) {
    return "gemini_api";
  }
  if (msg.includes("watchlist") || msg.includes("/user/me")) {
    return "macbid_watchlist";
  }
  if (msg.includes("live data") || msg.includes("live update")) {
    return "macbid_live_update";
  }
  if (msg.includes("lot") && (msg.includes("fetch") || msg.includes("failed"))) {
    return "macbid_lot_fetch";
  }
  if (msg.includes("building")) {
    return "macbid_buildings";
  }
  return "unknown";
}

/**
 * Log an error and track it for circuit breaker purposes.
 * Returns the tripped breaker rows if threshold is exceeded.
 */
export function trackError(
  db: Database,
  error: Error,
  lotId: number | null,
  threshold: number
): CircuitBreakerRow[] {
  const errorType = classifyError(error);

  // Log to error_log table
  const entry: ErrorLogEntry = {
    error_type: errorType,
    error_message: error.message,
    lot_id: lotId,
  };
  logError(db, entry);

  // Increment circuit breaker counter
  recordCircuitBreakerFailure(db, errorType);

  // Check if any breakers have tripped
  return getTrippedBreakers(db, threshold);
}

/**
 * Reset the circuit breaker for a specific error type on success.
 */
export function resetOnSuccess(db: Database, errorType: string): void {
  resetCircuitBreaker(db, errorType);
}

/**
 * Send a push notification via Ntfy.
 * Returns true if notification was sent successfully.
 */
export async function sendNtfyAlert(
  ntfyUrl: string,
  errorType: string,
  consecutiveFailures: number,
  lastMessage: string
): Promise<boolean> {
  try {
    const response = await fetch(ntfyUrl, {
      method: "POST",
      headers: {
        Title: `mac-bid-analyzer: Circuit Breaker Tripped`,
        Priority: "high",
        Tags: "warning",
      },
      body: `Error type: ${errorType}\nConsecutive failures: ${consecutiveFailures}\nLast error: ${lastMessage}`,
    });

    if (!response.ok) {
      log(`Ntfy notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    log(`Ntfy notification sent for ${errorType} (${consecutiveFailures} failures).`);
    return true;
  } catch (err) {
    log(`Ntfy unreachable: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Check tripped breakers, send notifications, and throw if any are tripped.
 */
export async function checkAndNotifyBreakers(
  db: Database,
  threshold: number,
  ntfyUrl: string
): Promise<void> {
  const tripped = getTrippedBreakers(db, threshold);

  if (tripped.length === 0) return;

  for (const breaker of tripped) {
    // Send Ntfy alert
    if (ntfyUrl) {
      await sendNtfyAlert(
        ntfyUrl,
        breaker.error_type,
        breaker.consecutive_failures,
        `Last failure at ${breaker.last_failure_at}`
      );
    } else {
      log(`Circuit breaker tripped for ${breaker.error_type} but no NTFY_URL configured.`);
    }

    // Mark as notified to avoid repeat alerts
    markBreakerNotified(db, breaker.error_type);

    throw new CircuitBreakerTripped(
      breaker.error_type,
      breaker.consecutive_failures,
      `Last failure at ${breaker.last_failure_at}`
    );
  }
}
