# Chrome Extension for mac.bid Analyzer

## 1. Introduction/Overview

A Chrome extension that detects when you're browsing mac.bid lot pages and provides instant access to price analysis via a side panel. The extension communicates with a new HTTP API layer added to the existing Bun backend, showing full analysis details (AI estimates, eBay comps, cost breakdowns, image flags) without leaving the browser.

## 2. Goals

- Eliminate context-switching between mac.bid and the CLI/Telegram when evaluating lots
- Provide full analysis detail (equivalent to the CLI `detail` command) directly in the browser
- Reuse all existing analysis logic by adding an HTTP API to the current Bun project
- Keep the extension lightweight — all compute happens server-side

## 3. User Stories

### US-001: Add HTTP API server to Bun project

**Description:** As a developer, I want an HTTP API endpoint that accepts a lot ID or URL and returns analysis results, so the Chrome extension has a backend to talk to.

**Acceptance Criteria:**

- [ ] New `src/server.ts` module exposes an HTTP server using `Bun.serve()`
- [ ] `POST /api/analyze` accepts `{ input: string, force?: boolean }` and returns the full `AnalyzedItem` as JSON
- [ ] `GET /api/lot/:lotId` returns cached analysis for a lot, or 404 if not found
- [ ] Server validates a static API token via `Authorization: Bearer <token>` header, returning 401 on mismatch
- [ ] Token is read from `API_TOKEN` environment variable
- [ ] New CLI subcommand `bun run src/cli.ts server` starts the HTTP server
- [ ] Server listens on a configurable port (default 3000, via `PORT` env var)
- [ ] Typecheck passes

### US-002: Chrome extension manifest and project scaffolding

**Description:** As a developer, I want the Chrome extension project scaffolded within this repo, so I can build and load it as an unpacked extension.

**Acceptance Criteria:**

- [ ] Extension lives in `extension/` directory at the repo root
- [ ] `extension/manifest.json` is a valid Manifest V3 Chrome extension
- [ ] Manifest declares `sidePanel` permission and `activeTab` permission
- [ ] Manifest declares a content script that matches `*://*.mac.bid/*` and `*://mac.bid/*`
- [ ] Extension can be loaded as an unpacked extension in Chrome and shows in the extensions list

### US-003: Detect mac.bid lot pages

**Description:** As a user, I want the extension to detect when I'm on a mac.bid lot page, so the side panel can show relevant controls.

**Acceptance Criteria:**

- [ ] Content script detects URLs matching `/auction/{auctionId}/lot/{lotNumber}` and `/lot/{lotId}`
- [ ] When on a lot page, the content script extracts the lot identifier from the URL
- [ ] Extension icon badge shows a colored indicator when a lot page is detected
- [ ] When not on a lot page, the side panel shows a message like "Navigate to a mac.bid lot page to analyze"

### US-004: Side panel with analyze button

**Description:** As a user, I want to see an "Analyze" button in the side panel when I'm on a lot page, so I can trigger analysis on demand.

**Acceptance Criteria:**

- [ ] Side panel opens via Chrome's built-in side panel API
- [ ] When on a detected lot page, the panel shows the lot identifier and an "Analyze" button
- [ ] Clicking "Analyze" sends the lot to the backend API and shows a loading state
- [ ] If analysis is already cached in the backend, results display immediately without needing to click "Analyze"
- [ ] Cached results show a "Re-analyze" button to force a fresh analysis

### US-005: Display full analysis results

**Description:** As a user, I want to see the complete analysis in the side panel, so I can make an informed bidding decision without leaving the page.

**Acceptance Criteria:**

- [ ] Side panel displays all fields from the analysis:
  - Product name, lot ID, condition
  - Current bid and total bids
  - Location and location tier/cost
  - eBay data: low/median/high, comp count, search query
  - AI estimate: low/mid/high, confidence, reasoning, comparables list
  - Image flags with severity and risk score (if present)
  - Cost breakdown: base estimate, sales tax rate, location cost
  - Recommended max bid (or "NOT WORTH IT" / "N/A")
  - Deal score
  - Analysis source
  - Manual review warning (if flagged)
- [ ] Currency values are formatted as `$X.XX`
- [ ] The panel is scrollable for long content
- [ ] Visual distinction between "good deal" (bid < max) and "over max" (bid > max) states

### US-006: Extension settings/configuration

**Description:** As a user, I want to configure the backend URL and API token in the extension settings, so the extension knows how to reach my server.

**Acceptance Criteria:**

- [ ] Extension has an options page accessible from Chrome's extension settings
- [ ] Options page has fields for: Backend URL (default `http://localhost:3000`), API Token
- [ ] Settings are persisted in `chrome.storage.sync`
- [ ] Extension shows a clear error if settings are not configured when trying to analyze

### US-007: Error handling and connectivity

**Description:** As a user, I want clear error messages when something goes wrong, so I know whether the issue is with my setup or the analysis itself.

**Acceptance Criteria:**

- [ ] If the backend is unreachable, the panel shows "Cannot connect to backend at [URL]. Is the server running?"
- [ ] If the API token is invalid (401), the panel shows "Invalid API token. Check your extension settings."
- [ ] If analysis fails server-side, the error message from the server is displayed
- [ ] Network errors show a "Retry" button

## 4. Functional Requirements

- **FR-1:** The HTTP API server must start via `bun run src/cli.ts server` and listen on the configured port.
- **FR-2:** The `POST /api/analyze` endpoint must accept a JSON body with `input` (string, required — lot URL or ID) and `force` (boolean, optional — re-analyze even if cached). It must return the full `AnalyzedItem` JSON on success, or a JSON error `{ error: string }` on failure.
- **FR-3:** The `GET /api/lot/:lotId` endpoint must return the cached `AnalyzedItem` for the given lot ID, or `{ error: "Not found" }` with status 404.
- **FR-4:** All API endpoints must validate the `Authorization: Bearer <token>` header and return 401 if the token doesn't match `API_TOKEN`.
- **FR-5:** The Chrome extension content script must detect mac.bid lot page URLs and extract the lot identifier (numeric ID or full URL path).
- **FR-6:** The side panel must communicate with the content script to know the current page's lot identifier.
- **FR-7:** When analysis results are returned, the side panel must render all data fields described in US-005.
- **FR-8:** The extension must check for cached results via `GET /api/lot/:lotId` before showing the "Analyze" button. If cached results exist, display them immediately.
- **FR-9:** The "Re-analyze" button must call `POST /api/analyze` with `force: true`.
- **FR-10:** The extension options page must persist backend URL and API token to `chrome.storage.sync` and validate that both fields are non-empty before saving.

## 5. Non-Goals (Out of Scope)

- **No bid placement or bid alerts** — the extension is view-only for analysis
- **No auction listing page support** — only individual lot detail pages are supported
- **No active items dashboard or deals list** — the extension only analyzes the current page's lot
- **No auto-analysis on page navigation** — user must click "Analyze" for new items
- **No extension publishing to Chrome Web Store** — this is a personal tool loaded as an unpacked extension
- **No mobile browser support** — Chrome desktop only
- **No WebSocket/real-time updates** — the extension fetches data on demand
- **No client-side API calls** — all eBay, LLM, and mac.bid API calls happen server-side

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|---|---|
| Backend server is not running | Side panel shows connectivity error with the configured URL and a suggestion to start the server |
| API token is missing from extension settings | Side panel shows "Configure your API token in extension settings" with a link to the options page |
| Lot page URL uses alphanumeric lot number (e.g., `2587T`) | Content script passes the full URL to the backend, which resolves it via `resolveLotId()` |
| User navigates away from lot page while analysis is in progress | Side panel shows "Navigate to a mac.bid lot page to analyze" — any in-flight request is ignored |
| Backend returns a 500 error during analysis | Side panel shows the server's error message and a "Retry" button |
| User navigates between lot pages quickly | Each navigation resets the side panel state; only the most recent lot is shown |
| Analysis returns `needs_manual_review: 1` | Side panel prominently displays the manual review warning and reason |
| Lot has no eBay comps and no AI estimate | Side panel shows "N/A" for max bid and displays available data |
| Backend URL is configured without protocol | Options page validation requires URL to start with `http://` or `https://` |

## 7. Technical Considerations

- **HTTP server:** Use `Bun.serve()` for the API layer. It runs in the same process as existing code and has direct access to the SQLite database, analysis pipeline, and config.
- **Shared analysis logic:** The `POST /api/analyze` endpoint should call `analyzeItem()` from `src/analyze.ts` directly — no duplication of analysis logic.
- **CORS:** The API server must include appropriate CORS headers since the Chrome extension's side panel makes requests from a `chrome-extension://` origin.
- **Extension build:** The extension uses plain HTML/CSS/JS (no build step needed). Manifest V3 with a service worker for background logic.
- **Side panel API:** Use Chrome's `chrome.sidePanel` API (available in Manifest V3, Chrome 114+).
- **Content script ↔ side panel communication:** Use `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` for the content script to notify the side panel of the current lot.
- **Existing patterns to reuse:**
  - `parseLotId()` and `resolveLotId()` from `src/analyze.ts` for input parsing on the server side
  - `resolveDisplayData()` from `src/format.ts` for structuring the response (or return raw `AnalyzedItem` and let the extension format it)
  - `loadConfig()` from `src/config.ts` for server-side configuration

## 8. Success Metrics

- Able to analyze a mac.bid lot from the browser in under 30 seconds (including LLM + eBay calls)
- Cached results display in under 1 second
- Zero analysis logic duplication — all compute reuses existing `analyzeItem()` pipeline
- Extension loads and functions as an unpacked extension without errors in the Chrome console

## 9. Open Questions

- Should the side panel auto-open when navigating to a mac.bid lot page, or should the user manually open it? (Chrome's side panel API allows both patterns)
- Should the server run as a persistent background process (e.g., via systemd/launchd), or is manual `bun run src/cli.ts server` sufficient?
- Would it be useful to show the lot's product image in the side panel (fetched from the lot's `image_url`)?
