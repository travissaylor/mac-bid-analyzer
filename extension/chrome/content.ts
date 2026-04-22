// Chrome MV3 content script.
//
// Wires the platform-agnostic shared library to chrome.* APIs:
//   - Detects mac.bid lot URLs on load, on URL changes (MutationObserver),
//     and on popstate, then notifies the SW so it can update the toolbar
//     badge.
//   - Renders an inline shadow-DOM badge card on lot pages (collapsed view).
//   - On tap of the badge "details" button, opens a full-screen modal
//     overlay with the full analysis (the desktop replacement for the
//     side panel that previously lived in sidepanel.{html,js}).
//   - Proxies backend fetches through the service worker via
//     chrome.runtime.sendMessage / BACKEND_FETCH.
//
// No top-level `export` statements — Bun bundles this to ESM, but MV3
// content scripts run as classic scripts; the absence of exports keeps
// the output runnable.

import { extractLotInfo } from "../shared/lot-url";
import { BADGE_STYLES, MODAL_STYLES } from "../shared/styles";
import {
  renderChecking,
  renderAnalyzing,
  renderNotAnalyzed,
  renderAnalyzed,
  renderError,
  renderNoToken,
  renderChip,
  renderSideTab,
  chipLabelFor,
  BADGE_CHROME_HTML,
} from "../shared/badge";
import { renderModal } from "../shared/modal";
import { resolveDisplayData } from "../shared/display";
import { fetchCached, postAnalyze } from "../shared/api";
import { BACKEND_URL, API_TOKEN } from "../shared/config";
import {
  getCardDefaultState,
  setCardDefaultState,
  subscribeCardDefaultState,
  DEFAULT_CARD_STATE,
  type CardDefaultState,
} from "../shared/preferences";
import type { LotInfo, AnalyzedItem, FetchFn } from "../shared/types";

// ---------- Module state ----------

const BADGE_HOST_ID = "mac-bid-analyzer-badge-host";
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

let badgeHost: HTMLElement | null = null;
let badgeShadow: ShadowRoot | null = null;
let currentLotInfo: LotInfo | null = null;
let inFlightAnalysis = false;
let lastAnalyzedItem: AnalyzedItem | null = null;
let feedbackInFlight = false;

// Last body rendered into the card so we can re-show it when restoring from
// chip / side-tab without re-fetching.
let lastCardVariant = "";
let lastCardBodyHtml = "";

// Persisted preference (loaded async at startup) and per-session override.
// effective = sessionState ?? persistedState. sessionState is reset on lot
// navigation and on persisted-pref change.
let persistedState: CardDefaultState = DEFAULT_CARD_STATE;
let sessionState: CardDefaultState | null = null;

// ---------- Shadow-DOM badge host ----------

function applyHostPosition(
  host: HTMLElement,
  isMobile: boolean
): void {
  // The host element lives outside the shadow DOM, so CSS @media inside
  // the shadow root cannot reach it. We update inline style on the host
  // here based on the viewport.
  if (isMobile) {
    host.style.top = "auto";
    host.style.bottom = "16px";
  } else {
    host.style.bottom = "auto";
    host.style.top = "80px";
  }
}

function ensureBadge(): ShadowRoot {
  const existing = document.getElementById(BADGE_HOST_ID);
  if (existing && badgeShadow) return badgeShadow;

  const host = document.createElement("div");
  host.id = BADGE_HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    right: "16px",
    zIndex: "2147483647",
  });

  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  applyHostPosition(host, mql.matches);
  // Listen for viewport breakpoint changes for the lifetime of this host.
  mql.addEventListener("change", (ev: MediaQueryListEvent) => {
    if (badgeHost) applyHostPosition(badgeHost, ev.matches);
  });

  document.documentElement.appendChild(host);
  badgeHost = host;

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // Both the badge card and the modal share this single style element so
  // they sit in the same isolated shadow scope.
  style.textContent = BADGE_STYLES + MODAL_STYLES;
  shadow.appendChild(style);

  // Three top-level UI states share this shadow root; only one is visible
  // at a time. Side-tab uses position:fixed (in CSS) to escape the host's
  // right:16px offset and anchor flush to the viewport edge.
  const card = document.createElement("div");
  card.id = "card";
  card.className = "card";
  shadow.appendChild(card);

  const chip = document.createElement("div");
  chip.id = "chip";
  chip.style.display = "none";
  shadow.appendChild(chip);

  const sideTab = document.createElement("div");
  sideTab.id = "side-tab";
  sideTab.className = "side-tab-host";
  sideTab.style.display = "none";
  shadow.appendChild(sideTab);

  const modalRoot = document.createElement("div");
  modalRoot.id = "modal-root";
  modalRoot.style.display = "none";
  shadow.appendChild(modalRoot);

  shadow.addEventListener("click", handleShadowClick);
  badgeShadow = shadow;
  return shadow;
}

function removeBadge(): void {
  document.getElementById(BADGE_HOST_ID)?.remove();
  badgeHost = null;
  badgeShadow = null;
  lastAnalyzedItem = null;
  lastCardVariant = "";
  lastCardBodyHtml = "";
  sessionState = null;
}

function effectiveState(): CardDefaultState {
  return sessionState ?? persistedState;
}

function setCard(variant: string, html: string): void {
  lastCardVariant = variant;
  lastCardBodyHtml = html;
  renderCurrentState();
}

function renderCurrentState(): void {
  const shadow = ensureBadge();
  const card = shadow.getElementById("card");
  const chip = shadow.getElementById("chip");
  const sideTab = shadow.getElementById("side-tab");
  if (!card || !chip || !sideTab) return;

  const state = effectiveState();
  if (state === "expanded") {
    card.style.display = "";
    chip.style.display = "none";
    sideTab.style.display = "none";
    card.className = `card ${lastCardVariant || ""}`.trim();
    card.innerHTML = BADGE_CHROME_HTML + `<div class="card-body">${lastCardBodyHtml}</div>`;
    updateOverflowMenuState(card);
  } else if (state === "minimized") {
    card.style.display = "none";
    chip.style.display = "";
    sideTab.style.display = "none";
    chip.innerHTML = renderChip(lastCardVariant, chipLabelFor(lastAnalyzedItem));
  } else {
    card.style.display = "none";
    chip.style.display = "none";
    sideTab.style.display = "";
    sideTab.innerHTML = renderSideTab(lastCardVariant);
  }
}

function updateOverflowMenuState(cardEl: HTMLElement): void {
  const items = cardEl.querySelectorAll<HTMLElement>(
    '.overflow-item[data-state]'
  );
  items.forEach((item) => {
    if (item.dataset.state === persistedState) {
      item.dataset.current = "true";
    } else {
      delete item.dataset.current;
    }
  });
}

function toggleOverflowMenu(force?: boolean): void {
  if (!badgeShadow) return;
  const menu = badgeShadow.querySelector<HTMLElement>(".overflow-menu");
  if (!menu) return;
  const open = force ?? menu.dataset.open !== "true";
  menu.dataset.open = open ? "true" : "false";
}

// ---------- BACKEND_FETCH proxy ----------

const backendFetch: FetchFn = async (opts) => {
  // Route through the SW to dodge mixed-content blocking when the backend
  // is plain HTTP and mac.bid is HTTPS.
  const resp = (await chrome.runtime.sendMessage({
    action: "BACKEND_FETCH",
    url: opts.url,
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
  })) as
    | { ok: boolean; status: number; body: unknown; error?: undefined }
    | { error: string }
    | undefined;

  if (!resp) throw new Error("No response from background");
  if ("error" in resp && resp.error) throw new Error(resp.error);
  const ok = (resp as { ok: boolean }).ok;
  const status = (resp as { status: number }).status;
  const body = (resp as { body: unknown }).body;
  return { ok, status, body };
};

// ---------- Badge flow ----------

function isNoTokenError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "NO_TOKEN"
  );
}

function renderAnalyzedAndCache(item: AnalyzedItem): void {
  lastAnalyzedItem = item;
  const { variant, html } = renderAnalyzed(item);
  setCard(variant, html);
}

async function checkAndRender(lotInfo: LotInfo): Promise<void> {
  const lotId = lotInfo.lotId;
  const checking = renderChecking();
  setCard(checking.variant, checking.html);
  try {
    const cached = await fetchCached(
      lotInfo,
      BACKEND_URL,
      API_TOKEN,
      backendFetch
    );
    if (currentLotInfo?.lotId !== lotId) return;
    if (cached) {
      renderAnalyzedAndCache(cached);
    } else {
      lastAnalyzedItem = null;
      const { variant, html } = renderNotAnalyzed();
      setCard(variant, html);
    }
  } catch (err) {
    if (currentLotInfo?.lotId !== lotId) return;
    if (isNoTokenError(err)) {
      const { variant, html } = renderNoToken();
      setCard(variant, html);
    } else {
      const message =
        err instanceof Error ? err.message : "Failed to check analysis";
      const { variant, html } = renderError(message);
      setCard(variant, html);
    }
  }
}

async function startAnalysis(force: boolean): Promise<void> {
  if (!currentLotInfo || inFlightAnalysis) return;
  inFlightAnalysis = true;
  const lotInfo = currentLotInfo;
  const lotId = lotInfo.lotId;
  const analyzing = renderAnalyzing();
  setCard(analyzing.variant, analyzing.html);
  try {
    const item = await postAnalyze(
      lotInfo,
      { force },
      BACKEND_URL,
      API_TOKEN,
      backendFetch
    );
    if (currentLotInfo?.lotId !== lotId) return;
    renderAnalyzedAndCache(item);
  } catch (err) {
    if (currentLotInfo?.lotId !== lotId) return;
    if (isNoTokenError(err)) {
      const { variant, html } = renderNoToken();
      setCard(variant, html);
    } else {
      const message = err instanceof Error ? err.message : "Analysis failed";
      const { variant, html } = renderError(message);
      setCard(variant, html);
    }
  } finally {
    inFlightAnalysis = false;
  }
}

function handleLotForBadge(lotInfo: LotInfo): void {
  const prev = currentLotInfo;
  currentLotInfo = lotInfo;
  if (!prev || prev.lotId !== lotInfo.lotId) {
    // Navigated to a new lot — close any open modal and drop session
    // override so the persisted preference applies fresh.
    closeModal();
    lastAnalyzedItem = null;
    sessionState = null;
    void checkAndRender(lotInfo);
  }
}

function handleNoLotForBadge(): void {
  currentLotInfo = null;
  removeBadge();
}

// ---------- Modal flow ----------

function getModalRoot(): HTMLElement | null {
  if (!badgeShadow) return null;
  return badgeShadow.getElementById("modal-root");
}

function openModal(): void {
  if (!currentLotInfo || !lastAnalyzedItem) return;
  const root = getModalRoot();
  if (!root) return;
  const displayData = resolveDisplayData(lastAnalyzedItem);
  root.innerHTML = renderModal(displayData);
  root.style.display = "block";
}

function closeModal(): void {
  const root = getModalRoot();
  if (!root) return;
  root.innerHTML = "";
  root.style.display = "none";
  feedbackInFlight = false;
}

function rerenderModal(): void {
  if (!lastAnalyzedItem) return;
  const root = getModalRoot();
  if (!root || root.style.display === "none") return;
  const displayData = resolveDisplayData(lastAnalyzedItem);
  root.innerHTML = renderModal(displayData);
}

function showModalError(message: string): void {
  const root = getModalRoot();
  if (!root) return;
  const content = root.querySelector(".modal-content");
  if (!content) return;
  let errEl = content.querySelector("#modal-error") as HTMLDivElement | null;
  if (!errEl) {
    errEl = document.createElement("div");
    errEl.id = "modal-error";
    errEl.style.color = "#b71c1c";
    errEl.style.fontSize = "12px";
    errEl.style.marginTop = "8px";
    const feedbackSection = content.querySelector("#feedback-section");
    if (feedbackSection) {
      feedbackSection.appendChild(errEl);
    } else {
      content.appendChild(errEl);
    }
  }
  errEl.textContent = message;
}

async function submitFeedback(value: string): Promise<void> {
  if (!currentLotInfo || feedbackInFlight) return;
  feedbackInFlight = true;
  const submitBtn = badgeShadow?.getElementById(
    "feedback-submit"
  ) as HTMLButtonElement | null;
  if (submitBtn) submitBtn.disabled = true;
  try {
    const item = await postAnalyze(
      currentLotInfo,
      { userFeedback: value },
      BACKEND_URL,
      API_TOKEN,
      backendFetch
    );
    renderAnalyzedAndCache(item);
    rerenderModal();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit feedback";
    showModalError(message);
    const after = badgeShadow?.getElementById(
      "feedback-submit"
    ) as HTMLButtonElement | null;
    if (after) after.disabled = false;
  } finally {
    feedbackInFlight = false;
  }
}

// ---------- Click delegation ----------

function handleShadowClick(event: Event): void {
  const target = event.target as Element | null;
  if (!target) return;

  // Nearest-ancestor wins: the feedback-submit button's own data-action
  // resolves before the backdrop's ancestor data-action, so clicks inside
  // .modal-content dispatch correctly instead of being swallowed by the
  // dismiss handler.
  const actionEl = target.closest("[data-action]") as HTMLElement | null;

  // Close overflow menu on any click that isn't the toggle or a menu item.
  if (
    !actionEl ||
    (actionEl.dataset.action !== "overflow-toggle" &&
      actionEl.dataset.action !== "set-default")
  ) {
    toggleOverflowMenu(false);
  }

  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "modal-dismiss") {
    // Dismiss fires for two elements sharing this action: the backdrop
    // (click outside the content) and the X close button (inside content).
    // Clicks on other content (textarea, whitespace) bubble to the backdrop
    // but must not dismiss.
    const el = target as HTMLElement;
    const isCloseBtn = el.closest(".modal-close");
    const insideContent = !isCloseBtn && el.closest(".modal-content");
    if (insideContent) return;
    closeModal();
  } else if (action === "analyze") {
    void startAnalysis(false);
  } else if (action === "reanalyze") {
    void startAnalysis(true);
  } else if (action === "details") {
    openModal();
  } else if (action === "feedback-submit") {
    const textarea = badgeShadow?.getElementById(
      "feedback-textarea"
    ) as HTMLTextAreaElement | null;
    const value = textarea?.value ?? "";
    void submitFeedback(value);
  } else if (action === "minimize") {
    // From the card: collapse to the most-collapsed reasonable state. If
    // the persisted preference is "hidden", honor that; otherwise chip.
    sessionState = persistedState === "hidden" ? "hidden" : "minimized";
    renderCurrentState();
  } else if (action === "restore") {
    sessionState = "expanded";
    renderCurrentState();
  } else if (action === "overflow-toggle") {
    toggleOverflowMenu();
  } else if (action === "set-default") {
    const next = actionEl.dataset.state as CardDefaultState | undefined;
    if (next === "expanded" || next === "minimized" || next === "hidden") {
      persistedState = next;
      sessionState = null;
      void setCardDefaultState(next);
      toggleOverflowMenu(false);
      renderCurrentState();
    }
  }
}

// ---------- Detection + SW notification ----------

function notifyLotStatus(): void {
  const lotInfo = extractLotInfo(window.location.href);
  if (lotInfo) {
    void chrome.runtime
      .sendMessage({ action: "LOT_DETECTED", lotInfo })
      .catch(() => {
        // SW may be reloading; the next URL change will retry.
      });
    handleLotForBadge(lotInfo);
  } else {
    void chrome.runtime
      .sendMessage({ action: "LOT_NOT_DETECTED" })
      .catch(() => {
        // Same — non-fatal.
      });
    handleNoLotForBadge();
  }
}

// Load the persisted card-default preference once at startup. Until it
// resolves, effective state falls back to DEFAULT_CARD_STATE ("expanded").
void getCardDefaultState().then((state) => {
  persistedState = state;
  if (badgeShadow) renderCurrentState();
});

// React to preference changes from other tabs (chrome.storage.sync).
subscribeCardDefaultState((state) => {
  persistedState = state;
  sessionState = null;
  if (badgeShadow) renderCurrentState();
});

// Initial detection on script injection.
notifyLotStatus();

// Re-detect on URL changes (mac.bid uses client-side navigation).
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    notifyLotStatus();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Back/forward navigation.
window.addEventListener("popstate", notifyLotStatus);
