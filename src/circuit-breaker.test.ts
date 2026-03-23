import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  classifyError,
  trackError,
  resetOnSuccess,
  sendNtfyAlert,
  checkAndNotifyBreakers,
  CircuitBreakerTripped,
} from "./circuit-breaker";
import {
  openDatabase,
  getTrippedBreakers,
} from "./db";
import type { CircuitBreakerRow } from "./db";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("circuit-breaker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "macbid-cb-test-"));
  });

  afterEach(() => {
    restoreFetch();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("classifyError", () => {
    it("should classify firebase auth errors", () => {
      expect(classifyError(new Error("Firebase sign-in failed"))).toBe("auth");
      expect(classifyError(new Error("Failed to authenticate"))).toBe("auth");
    });

    it("should classify eBay API errors", () => {
      expect(classifyError(new Error("eBay search failed: 500"))).toBe("ebay_api");
    });

    it("should classify Gemini errors", () => {
      expect(classifyError(new Error("Gemini API rate limited"))).toBe("gemini_api");
    });

    it("should classify macbid watchlist errors", () => {
      expect(classifyError(new Error("Failed to fetch watchlist: 401"))).toBe("macbid_watchlist");
    });

    it("should classify macbid lot fetch errors", () => {
      expect(classifyError(new Error("Failed to fetch lot 123: 500"))).toBe("macbid_lot_fetch");
    });

    it("should classify building errors", () => {
      expect(classifyError(new Error("Failed to fetch buildings"))).toBe("macbid_buildings");
    });

    it("should classify live data errors", () => {
      expect(classifyError(new Error("Failed to fetch live data for lot 123"))).toBe("macbid_live_update");
    });

    it("should default to unknown for unrecognized errors", () => {
      expect(classifyError(new Error("Something weird happened"))).toBe("unknown");
    });
  });

  describe("trackError", () => {
    it("should log error and increment circuit breaker counter", () => {
      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 123: 500");
        trackError(db, error, 123, 5);

        // Verify error was logged
        const logStmt = db.prepare("SELECT * FROM error_log WHERE lot_id = 123");
        const logEntry = logStmt.get() as Record<string, unknown>;
        expect(logEntry).not.toBeNull();
        expect(logEntry.error_type).toBe("macbid_lot_fetch");
        expect(logEntry.error_message).toBe("Failed to fetch lot 123: 500");

        // Verify circuit breaker was incremented
        const cbStmt = db.prepare("SELECT * FROM circuit_breaker WHERE error_type = 'macbid_lot_fetch'");
        const cbRow = cbStmt.get() as CircuitBreakerRow;
        expect(cbRow).not.toBeNull();
        expect(cbRow.consecutive_failures).toBe(1);
      } finally {
        db.close();
      }
    });

    it("should return tripped breakers when threshold exceeded", () => {
      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        for (let i = 0; i < 4; i++) {
          trackError(db, error, 1, 5);
        }
        // 4 failures — not tripped yet
        let tripped = getTrippedBreakers(db, 5);
        expect(tripped).toHaveLength(0);

        // 5th failure — should trip
        const result = trackError(db, error, 1, 5);
        expect(result).toHaveLength(1);
        expect(result[0].error_type).toBe("macbid_lot_fetch");
        expect(result[0].consecutive_failures).toBe(5);
      } finally {
        db.close();
      }
    });
  });

  describe("resetOnSuccess", () => {
    it("should delete circuit breaker row for the error type", () => {
      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        trackError(db, error, 1, 5);

        const cbBefore = db.prepare("SELECT * FROM circuit_breaker WHERE error_type = 'macbid_lot_fetch'").get();
        expect(cbBefore).not.toBeNull();

        resetOnSuccess(db, "macbid_lot_fetch");

        const cbAfter = db.prepare("SELECT * FROM circuit_breaker WHERE error_type = 'macbid_lot_fetch'").get();
        expect(cbAfter).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  describe("sendNtfyAlert", () => {
    it("should send POST to ntfy URL with correct headers and body", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      mockFetch(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response("OK", { status: 200 });
      });

      const result = await sendNtfyAlert(
        "http://localhost:2586/test",
        "macbid_lot_fetch",
        5,
        "Failed to fetch lot"
      );

      expect(result).toBe(true);
      expect(capturedUrl).toBe("http://localhost:2586/test");
      expect(capturedInit?.method).toBe("POST");
      expect((capturedInit?.headers as Record<string, string>).Title).toBe(
        "mac-bid-analyzer: Circuit Breaker Tripped"
      );
      expect((capturedInit?.headers as Record<string, string>).Priority).toBe("high");
      expect(capturedInit?.body).toContain("macbid_lot_fetch");
      expect(capturedInit?.body).toContain("5");
    });

    it("should return false on non-OK response", async () => {
      mockFetch(async () => new Response("Error", { status: 500 }));
      const result = await sendNtfyAlert("http://localhost/test", "auth", 5, "msg");
      expect(result).toBe(false);
    });

    it("should return false and not crash when ntfy is unreachable", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });
      const result = await sendNtfyAlert("http://localhost/test", "auth", 5, "msg");
      expect(result).toBe(false);
    });
  });

  describe("checkAndNotifyBreakers", () => {
    it("should do nothing when no breakers are tripped", async () => {
      const db = openDatabase(tmpDir);
      try {
        // No errors tracked — should not throw
        await checkAndNotifyBreakers(db, 5, "http://localhost/test");
      } finally {
        db.close();
      }
    });

    it("should send notification and throw when breaker is tripped", async () => {
      mockFetch(async () => new Response("OK", { status: 200 }));

      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        for (let i = 0; i < 5; i++) {
          trackError(db, error, 1, 5);
        }

        await expect(
          checkAndNotifyBreakers(db, 5, "http://localhost/test")
        ).rejects.toBeInstanceOf(CircuitBreakerTripped);

        // Verify notified flag was set
        const cbRow = db.prepare("SELECT * FROM circuit_breaker WHERE error_type = 'macbid_lot_fetch'").get() as CircuitBreakerRow;
        expect(cbRow.notified).toBe(1);
      } finally {
        db.close();
      }
    });

    it("should not re-notify after notified flag is set", async () => {
      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        for (let i = 0; i < 5; i++) {
          trackError(db, error, 1, 5);
        }

        mockFetch(async () => new Response("OK", { status: 200 }));

        // First check — trips and notifies
        try {
          await checkAndNotifyBreakers(db, 5, "http://localhost/test");
        } catch {
          // expected
        }

        // Second check — should not throw since notified = 1
        await checkAndNotifyBreakers(db, 5, "http://localhost/test");
      } finally {
        db.close();
      }
    });

    it("should still throw even if ntfy fails", async () => {
      mockFetch(async () => {
        throw new Error("Connection refused");
      });

      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        for (let i = 0; i < 5; i++) {
          trackError(db, error, 1, 5);
        }

        await expect(
          checkAndNotifyBreakers(db, 5, "http://localhost/test")
        ).rejects.toBeInstanceOf(CircuitBreakerTripped);
      } finally {
        db.close();
      }
    });

    it("should log but not crash when ntfy URL is empty", async () => {
      const db = openDatabase(tmpDir);
      try {
        const error = new Error("Failed to fetch lot 1: 500");
        for (let i = 0; i < 5; i++) {
          trackError(db, error, 1, 5);
        }

        await expect(
          checkAndNotifyBreakers(db, 5, "")
        ).rejects.toBeInstanceOf(CircuitBreakerTripped);
      } finally {
        db.close();
      }
    });
  });
});
