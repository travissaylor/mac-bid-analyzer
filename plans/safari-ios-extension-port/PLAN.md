# Plan: Port mac.bid Analyzer Extension to Safari iOS

## Goal

Bring the Chrome extension's in-page analysis workflow to mac.bid browsing on iPhone, replacing the current Telegram-based mobile workflow which requires cumbersome app-switching between Safari and Telegram.

## Context

The existing `extension/` directory implements an MV3 Chrome extension that:
- Detects mac.bid lot URLs via `content.js`
- Renders an inline shadow-DOM badge showing the recommended max bid
- Opens a Chrome side panel with full analysis detail (eBay comps, AI reasoning, image flags, cost breakdown, feedback textarea)
- Proxies HTTP fetches to a self-hosted Bun backend through the service worker (works around mixed-content blocking when the backend is plain HTTP)

The user already runs the same backend on a home Ubuntu server reachable via Tailscale. The Telegram bot in `src/telegram.ts` provides the current mobile workflow but requires copy/paste between Safari and Telegram.

## Constraints and pre-decided facts

- **iOS Safari is the only viable in-page surface on iPhone.** Chrome on iOS does not support extensions; only Safari does (via Safari Web Extensions wrapped in an Xcode project).
- **The user has a paid Apple Developer account.** No 7-day re-signing cycle.
- **Tailscale on iOS** handles backend reachability; the existing `BACKEND_FETCH` service-worker proxy pattern carries over unchanged.
- **The user wants the same UX on both platforms.** Whatever ships to iOS must also be the desktop experience.

## Architecture decisions

### Repo structure

```
extension/
  shared/                 # Pure TS, no chrome.* calls
    display.ts            # resolveDisplayData, renderResults — HTML-string output
    badge.ts              # renderAnalyzed, renderChecking, renderError, renderNotAnalyzed
    modal.ts              # full-screen expanded view rendering + dismiss handling
    styles.ts             # BADGE_STYLES + MODAL_STYLES constants
    lot-url.ts            # extractLotInfo, LOT_URL_PATTERNS
    api.ts                # fetchCached, postAnalyze; takes a fetch fn as param
    types.ts              # AnalyzedItem, DisplayData, LotInfo
    config.ts             # generated at build time from .env (BACKEND_URL, API_TOKEN)
  chrome/
    manifest.json
    content.ts            # imports from ../shared, wires chrome.* APIs
    service-worker.ts     # BACKEND_FETCH proxy + toolbar badge (chrome-only)
  safari/
    manifest.json         # + browser_specific_settings, Tailscale host_permissions
    content.ts            # same logic, no toolbar badge calls
    service-worker.ts     # BACKEND_FETCH proxy only
    ios-app/              # Xcode project, Resources -> ../../dist/safari (folder ref)
  build.ts                # Bun build script — outputs dist/chrome/ and dist/safari/
dist/
  chrome/                 # loaded as Chrome unpacked extension
  safari/                 # Xcode Resources folder-references this
```

The per-platform directories stay thin; nearly all logic lives in `shared/`. Entry points wire the shared library to platform-specific browser APIs.

### Build pipeline

- Bun's built-in bundler (`bun build`) bundles each platform's entry points (TS) into the corresponding `dist/{chrome,safari}/` directory.
- A `build.ts` script reads `.env`, emits `shared/config.ts` with `BACKEND_URL` and `API_TOKEN` constants, then bundles. (Alternatively use `bun build --define`; either works.)
- Bun handles TypeScript natively — no separate `tsc` step.
- `@types/chrome` (or `webextension-polyfill-types` for cross-browser typings) added as a dev dependency so Safari API gaps surface at build time.

### UX

- **Inline shadow-DOM badge** stays as the primary surface (already works well on desktop). Whole card becomes a tap target on mobile.
- **Position**: `top: 80px; right: 16px` on desktop (current); `bottom: 16px; right: 16px` on mobile via `@media (max-width: 768px)` CSS inside the shadow stylesheet.
- **Expanded view: full-screen modal overlay**, both platforms. Triggered by tap on the collapsed badge. Renders all detail (eBay comps, AI reasoning, image flags, cost breakdown, feedback textarea + submit). Dismiss via X button or tap-on-backdrop. All `sidepanel.js` rendering logic lifts into `shared/display.ts` and `shared/modal.ts`.
- **Side panel deleted entirely** (`sidepanel.html`, `sidepanel.js`, side-panel manifest entry, `OPEN_SIDE_PANEL` message handler).
- **Options page deleted entirely** (`options.html`, `options.js`, manifest entry). Backend URL + API token baked in at build time.
- `chrome.sidePanel` and `chrome.action.setBadgeText` calls feature-guarded (`?.` chains, optional chaining) since Safari iOS lacks both.

### Auth and config

- `BACKEND_URL` and `API_TOKEN` baked in at build time from `.env`. No options page on either platform after refactor.
- Threat model: bundle lives on the user's personal devices, signed under personal dev cert; backend reachable only via tailnet. Embedded token is not a meaningful exposure.
- To rotate or change values: edit `.env`, rebuild, redeploy.

### Xcode project

- Generated via `xcrun safari-web-extension-converter dist/safari` once.
- Default behavior copies extension files into the Xcode project's Resources — re-point Resources to a folder reference at `../../dist/safari` (one-time fix in Xcode's Project Navigator: delete the copied Resources group, drag in `dist/safari` as "Create folder references"). After this, every `bun build` is reflected on the next Xcode build.
- Project lives at `extension/safari/ios-app/`.
- Git: commit `*.xcodeproj/project.pbxproj` and source files; gitignore `xcuserdata/`, `DerivedData/`.

## Sequencing

### Phase 1 — Desktop refactor (Chrome only)

Goal: validate the modal-instead-of-side-panel UX on desktop before paying the Xcode tax.

1. Add Bun bundler step (`build.ts`) and `dist/chrome/` output directory.
2. Add `@types/chrome` dev dependency.
3. Convert `extension/` files from `.js` to `.ts` (mechanical, JSDoc helps).
4. Split into `shared/` + `chrome/` directories.
5. Lift `resolveDisplayData` and `renderResults` from `sidepanel.js` into `shared/display.ts`.
6. Build `shared/modal.ts` — full-screen modal with backdrop, internal scroll, dismiss handlers.
7. Wire content script tap-on-badge → open modal.
8. Move feedback textarea + POST flow into the modal.
9. Delete `sidepanel.html`, `sidepanel.js`, side-panel manifest entries, `OPEN_SIDE_PANEL` message handler.
10. Delete `options.html`, `options.js`, options-page manifest entry; bake config at build time.
11. Update `chrome/service-worker.ts` to keep `BACKEND_FETCH` proxy and toolbar badge logic.
12. Load `dist/chrome/` as unpacked extension; verify on real mac.bid lots.
13. Use it for several days. Validate the modal UX is actually preferable before phase 2.

### Phase 2 — Safari port

Goal: ship the same code to iPhone Safari.

1. Create `extension/safari/` mirroring `chrome/` structure with `safari/manifest.json` (add `browser_specific_settings`, Tailscale hostname in `host_permissions`).
2. Update `build.ts` to also emit `dist/safari/`.
3. Verify mac.bid mobile assumptions on phone:
   - Lot URL patterns in `extension/shared/lot-url.ts` match what mobile Safari sees
   - `bottom: 16px; right: 16px` clears mac.bid's sticky mobile UI (header, "Place Bid" button)
4. Run `xcrun safari-web-extension-converter dist/safari` from `extension/safari/`. Move output into `ios-app/`.
5. In Xcode, re-point Resources to folder reference at `../../dist/safari`.
6. Configure code signing with the existing Apple Developer account.
7. Build and install on iPhone via USB.
8. Enable extension in iOS Settings → Safari → Extensions; grant mac.bid host permission.
9. Verify the in-page badge appears on a real mac.bid lot in mobile Safari.
10. Use Safari Web Inspector (Mac connected to iPhone) to debug any platform-specific issues.

## Risks and unknowns

- **mac.bid mobile UI collision**: bottom-right badge anchor may overlap mac.bid's sticky bid button or floating elements. Verify in phase 2; reposition or add a drag-to-move affordance if needed.
- **Safari MV3 service worker quirks**: Safari's implementation of MV3 service workers has subtle differences from Chrome's (lifetime, message passing). The `BACKEND_FETCH` proxy pattern should carry over but needs verification once installed.
- **Mixed-content over Tailscale**: the backend is HTTP. Safari iOS may apply ATS more strictly than Chrome. The service-worker proxy avoids the page-context fetch ban, but the SW itself still needs to fetch HTTP — should work via `host_permissions` allowance, but verify.
- **Xcode signing friction**: even with a paid dev account, provisioning profile setup occasionally drags. Budget half a day for first install.
- **Modal UX regression risk on desktop**: if the user has been relying on the persistent side panel as a "second screen", the modal-on-tap pattern may feel worse. Phase 1 ships and bakes for several days specifically to surface this before phase 2.

## Out of scope for this plan

- New analysis features
- Backend API changes
- Authentication beyond the existing Bearer token
- Distribution beyond personal device install (no App Store, no TestFlight)
- macOS Safari support (the converter can produce a Mac target too, but desktop already has a working Chrome extension)
