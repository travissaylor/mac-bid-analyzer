# PRD: Firebase API Key Auto-Discovery

## 1. Introduction/Overview

The mac-bid-analyzer authenticates with mac.bid via Firebase, using a hardcoded API key. When mac.bid rotates this key, the app breaks entirely with "API key not valid" errors. This feature makes the app self-healing by automatically scraping the current Firebase API key from the mac.bid website when authentication fails.

## 2. Goals

- Eliminate manual intervention when mac.bid rotates their Firebase API key
- Maintain zero-config operation — the app should recover from key rotation without user action
- Cache discovered keys to avoid unnecessary scraping on every run
- Provide clear diagnostics when auto-discovery itself fails

## 3. User Stories

### US-001: Auto-recover from rotated API key

**Description:** As a user running `bun start watchlist`, I want the app to automatically discover the new Firebase API key when the current one is invalid, so that key rotations don't break my workflow.

**Acceptance Criteria:**

- [ ] When Firebase returns "API key not valid", the app scrapes mac.bid for the current key
- [ ] The app retries authentication with the newly discovered key
- [ ] If retry succeeds, the run continues normally with no user action required
- [ ] The successful key is cached to disk for future runs

### US-002: Cached key used on subsequent runs

**Description:** As a user, I want the app to reuse a previously discovered API key so that it doesn't scrape mac.bid on every run.

**Acceptance Criteria:**

- [ ] On startup, the app reads the cached key file if it exists
- [ ] The cached key is used for the first authentication attempt
- [ ] If the cached key fails, the app scrapes for a fresh key and updates the cache
- [ ] If no cache file exists, the app uses the hardcoded fallback key for the first attempt

### US-003: Clear error when scraping fails

**Description:** As a user, I want a clear error message when the app cannot discover the API key, so I know exactly what went wrong and what to do.

**Acceptance Criteria:**

- [ ] If the mac.bid page cannot be fetched (network error, non-200 status), the error message includes the HTTP status or network error
- [ ] If the page is fetched but no API key pattern is found, the error says the page structure may have changed
- [ ] The error message suggests setting a `FIREBASE_API_KEY` env var as a manual override
- [ ] The app does not fall back to the hardcoded key — it fails clearly

## 4. Functional Requirements

- **FR-1:** The system must scrape the Firebase API key from the mac.bid website by fetching page HTML and/or linked JavaScript bundles and extracting the `apiKey` value from a Firebase configuration object.
- **FR-2:** Key discovery must be triggered only on Firebase authentication failure (HTTP error with "API key not valid" or equivalent message), not on every run.
- **FR-3:** After successful discovery, the key must be cached to a local file (e.g., `.firebase-api-key`) in the project root directory.
- **FR-4:** On startup, the system must check for a cached key file and use it if present. If no cache exists, it must use the current hardcoded key as the initial attempt.
- **FR-5:** After discovering a new key, the system must retry the failed authentication exactly once with the new key.
- **FR-6:** If the retry also fails, the system must report the error and stop — no infinite retry loops.
- **FR-7:** The scraper must search for the API key in both inline `<script>` tags and external JavaScript bundle files linked from the page.
- **FR-8:** The API key pattern to match is a string value assigned to an `apiKey` property in a Firebase config object (typically matching `AIzaSy[a-zA-Z0-9_-]{33}`).
- **FR-9:** The `.firebase-api-key` cache file must be added to `.gitignore`.

## 5. Non-Goals (Out of Scope)

- No environment variable override for the API key (keep it zero-config)
- No TTL-based cache expiration — the cache is invalidated only by auth failure
- No ntfy notifications when scraping fails — just a clear error message
- No automatic retries if mac.bid itself is down — fail fast
- No headless browser / JS execution — static HTML/JS parsing only

## 6. Edge Cases & Error Handling

- **mac.bid is down or unreachable:** Log the network error, fail with a message like "Could not reach mac.bid to discover Firebase API key. Check your network connection."
- **mac.bid returns HTML but no Firebase config found:** Log "Firebase API key not found in mac.bid page source. The site structure may have changed." Suggest manual `FIREBASE_API_KEY` env var as workaround.
- **API key found but still invalid:** After one retry with the scraped key, fail with "Discovered API key is also invalid. The mac.bid Firebase project may have changed."
- **Multiple API keys found in page source:** Use the first match. Firebase web apps typically have one config.
- **Cache file is corrupted or empty:** Treat as missing — fall back to hardcoded key, then scrape on failure.
- **Concurrent runs:** No locking needed — worst case, two runs scrape simultaneously and both write the same key.

## 7. Technical Considerations

- **Existing code:** The `firebase-auth.ts` module currently hardcodes `FIREBASE_API_KEY` on line 8 and uses it in `signInWithEmail()` and `refreshIdToken()`. The key needs to become a parameter or be resolved dynamically.
- **Scraping approach:** Use `fetch()` (already available via Bun) to GET `https://mac.bid`. Parse the HTML response as text. Use regex to find `apiKey` patterns. If not found in inline scripts, extract `<script src="...">` URLs, fetch those, and search them.
- **Cache file location:** Follow the existing pattern of `.firebase-token` — use `.firebase-api-key` in the project root.
- **Auth flow change:** `getFirebaseIdToken()` currently calls `signInWithEmail()` directly. It needs to catch API-key-specific errors, trigger discovery, and retry.
- **Token cache invalidation:** When a new API key is discovered, the existing `.firebase-token` cache should be cleared since tokens from the old key are invalid.

## 8. Success Metrics

- The app recovers from a Firebase API key rotation without user intervention
- Zero "API key not valid" errors that require manual fixes
- Scraping adds less than 2 seconds to a run (only on first failure after key rotation)

## 9. Open Questions

- **Where exactly is the Firebase config on mac.bid?** It could be in an inline script, an external JS bundle, or even a dynamically loaded chunk. The scraper should try inline scripts first, then external bundles. Needs investigation during implementation.
- **Does mac.bid use any bot protection** (Cloudflare, rate limiting) that would block a plain `fetch()`? If so, the scraping approach may need headers (User-Agent, etc.) to succeed.
- **Should the hardcoded key be removed entirely** once auto-discovery is proven reliable, or kept as a bootstrap fallback?
