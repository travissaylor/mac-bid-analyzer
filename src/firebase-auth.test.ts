import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  signInWithEmail,
  refreshIdToken,
  getFirebaseIdToken,
  clearCachedTokens,
  type FirebaseTokens,
} from "./firebase-auth";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = handler as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "firebase-auth-test-"));
}

describe("firebase-auth", () => {
  describe("signInWithEmail", () => {
    it("returns tokens on successful sign-in", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            idToken: "test-id-token",
            refreshToken: "test-refresh-token",
            expiresIn: "3600",
          }),
          { status: 200 }
        )
      );

      const result = await signInWithEmail("user@example.com", "password123");

      expect(result.idToken).toBe("test-id-token");
      expect(result.refreshToken).toBe("test-refresh-token");
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("sends correct request body", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            idToken: "tok",
            refreshToken: "ref",
            expiresIn: "3600",
          }),
          { status: 200 }
        );
      });

      await signInWithEmail("user@test.com", "pass");

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.email).toBe("user@test.com");
      expect(parsed.password).toBe("pass");
      expect(parsed.returnSecureToken).toBe(true);
    });

    it("calls the correct Firebase sign-in URL", async () => {
      let capturedUrl: string | undefined;

      mockFetch(async (url) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            idToken: "tok",
            refreshToken: "ref",
            expiresIn: "3600",
          }),
          { status: 200 }
        );
      });

      await signInWithEmail("user@test.com", "pass");

      expect(capturedUrl).toContain("identitytoolkit.googleapis.com");
      expect(capturedUrl).toContain("signInWithPassword");
    });

    it("throws on invalid credentials", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({ error: { message: "INVALID_PASSWORD" } }),
          { status: 400 }
        )
      );

      expect(signInWithEmail("user@example.com", "wrong")).rejects.toThrow(
        "Firebase sign-in failed: INVALID_PASSWORD"
      );
    });

    it("throws on non-ok response without error message", async () => {
      mockFetch(async () =>
        new Response(JSON.stringify({}), { status: 500 })
      );

      expect(signInWithEmail("user@example.com", "pass")).rejects.toThrow(
        "Firebase sign-in failed: HTTP 500"
      );
    });
  });

  describe("refreshIdToken", () => {
    it("returns new tokens on successful refresh", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({
            id_token: "new-id-token",
            refresh_token: "new-refresh-token",
            expires_in: "3600",
          }),
          { status: 200 }
        )
      );

      const result = await refreshIdToken("old-refresh-token");

      expect(result.idToken).toBe("new-id-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it("sends refresh token in form-encoded body", async () => {
      let capturedBody: string | undefined;

      mockFetch(async (_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            id_token: "tok",
            refresh_token: "ref",
            expires_in: "3600",
          }),
          { status: 200 }
        );
      });

      await refreshIdToken("my-refresh-token");

      expect(capturedBody).toContain("grant_type=refresh_token");
      expect(capturedBody).toContain("refresh_token=my-refresh-token");
    });

    it("calls the correct Firebase refresh URL", async () => {
      let capturedUrl: string | undefined;

      mockFetch(async (url) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            id_token: "tok",
            refresh_token: "ref",
            expires_in: "3600",
          }),
          { status: 200 }
        );
      });

      await refreshIdToken("my-refresh-token");

      expect(capturedUrl).toContain("securetoken.googleapis.com");
    });

    it("throws on expired refresh token", async () => {
      mockFetch(async () =>
        new Response(
          JSON.stringify({ error: { message: "TOKEN_EXPIRED" } }),
          { status: 400 }
        )
      );

      expect(refreshIdToken("expired-token")).rejects.toThrow(
        "Firebase token refresh failed: TOKEN_EXPIRED"
      );
    });
  });

  describe("getFirebaseIdToken", () => {
    it("does full sign-in when no cached token exists", async () => {
      const tempDir = makeTempDir();

      mockFetch(async () =>
        new Response(
          JSON.stringify({
            idToken: "fresh-id-token",
            refreshToken: "fresh-refresh-token",
            expiresIn: "3600",
          }),
          { status: 200 }
        )
      );

      const token = await getFirebaseIdToken("user@test.com", "pass", tempDir);

      expect(token).toBe("fresh-id-token");

      // Verify token was cached to file
      const tokenPath = join(tempDir, ".firebase-token");
      expect(existsSync(tokenPath)).toBe(true);
      const cached = JSON.parse(readFileSync(tokenPath, "utf-8"));
      expect(cached.refreshToken).toBe("fresh-refresh-token");

      unlinkSync(tokenPath);
    });

    it("uses cached ID token when still valid", async () => {
      const tempDir = makeTempDir();
      const tokenPath = join(tempDir, ".firebase-token");

      const cachedTokens: FirebaseTokens = {
        idToken: "cached-id-token",
        refreshToken: "cached-refresh-token",
        expiresAt: Date.now() + 600_000,
      };
      writeFileSync(tokenPath, JSON.stringify(cachedTokens));

      let fetchCalled = false;
      mockFetch(async () => {
        fetchCalled = true;
        return new Response("", { status: 500 });
      });

      const token = await getFirebaseIdToken("user@test.com", "pass", tempDir);

      expect(token).toBe("cached-id-token");
      expect(fetchCalled).toBe(false);

      unlinkSync(tokenPath);
    });

    it("refreshes token when ID token is expired but refresh token is valid", async () => {
      const tempDir = makeTempDir();
      const tokenPath = join(tempDir, ".firebase-token");

      const cachedTokens: FirebaseTokens = {
        idToken: "expired-id-token",
        refreshToken: "valid-refresh-token",
        expiresAt: Date.now() - 1000,
      };
      writeFileSync(tokenPath, JSON.stringify(cachedTokens));

      mockFetch(async () =>
        new Response(
          JSON.stringify({
            id_token: "refreshed-id-token",
            refresh_token: "new-refresh-token",
            expires_in: "3600",
          }),
          { status: 200 }
        )
      );

      const token = await getFirebaseIdToken("user@test.com", "pass", tempDir);

      expect(token).toBe("refreshed-id-token");

      const updated = JSON.parse(readFileSync(tokenPath, "utf-8"));
      expect(updated.refreshToken).toBe("new-refresh-token");

      unlinkSync(tokenPath);
    });

    it("falls back to full sign-in when refresh fails", async () => {
      const tempDir = makeTempDir();
      const tokenPath = join(tempDir, ".firebase-token");

      const cachedTokens: FirebaseTokens = {
        idToken: "expired-id-token",
        refreshToken: "invalid-refresh-token",
        expiresAt: Date.now() - 1000,
      };
      writeFileSync(tokenPath, JSON.stringify(cachedTokens));

      let callCount = 0;
      mockFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ error: { message: "TOKEN_EXPIRED" } }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            idToken: "fallback-id-token",
            refreshToken: "fallback-refresh-token",
            expiresIn: "3600",
          }),
          { status: 200 }
        );
      });

      const token = await getFirebaseIdToken("user@test.com", "pass", tempDir);

      expect(token).toBe("fallback-id-token");
      expect(callCount).toBe(2);

      unlinkSync(tokenPath);
    });

    it("throws when no credentials and no cached token", async () => {
      const tempDir = makeTempDir();

      expect(getFirebaseIdToken("", "", tempDir)).rejects.toThrow(
        "MACBID_EMAIL and MACBID_PASSWORD must be set"
      );
    });

    it("handles corrupt cached token file gracefully", async () => {
      const tempDir = makeTempDir();
      const tokenPath = join(tempDir, ".firebase-token");

      writeFileSync(tokenPath, "not valid json{{{");

      mockFetch(async () =>
        new Response(
          JSON.stringify({
            idToken: "fresh-token",
            refreshToken: "fresh-refresh",
            expiresIn: "3600",
          }),
          { status: 200 }
        )
      );

      const token = await getFirebaseIdToken("user@test.com", "pass", tempDir);

      expect(token).toBe("fresh-token");

      unlinkSync(tokenPath);
    });
  });

  describe("clearCachedTokens", () => {
    it("removes the token file", () => {
      const tempDir = makeTempDir();
      const tokenPath = join(tempDir, ".firebase-token");

      writeFileSync(tokenPath, "{}");
      expect(existsSync(tokenPath)).toBe(true);

      clearCachedTokens(tempDir);
      expect(existsSync(tokenPath)).toBe(false);
    });

    it("does not throw if file does not exist", () => {
      const tempDir = makeTempDir();
      expect(() => clearCachedTokens(tempDir)).not.toThrow();
    });
  });
});
