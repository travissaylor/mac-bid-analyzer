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
} from "../shared/badge";
import { renderModal } from "../shared/modal";
import { resolveDisplayData } from "../shared/display";
import { fetchCached, postAnalyze } from "../shared/api";
import { BACKEND_URL, API_TOKEN } from "../shared/config";
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

  const card = document.createElement("div");
  card.id = "card";
  card.className = "card";
  shadow.appendChild(card);

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
}

function setCard(variant: string, html: string): void {
  const shadow = ensureBadge();
  const card = shadow.getElementById("card");
  if (!card) return;
  card.className = `card ${variant || ""}`.trim();
  card.innerHTML = html;
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
    // Navigated to a new lot — close any open modal from the prior lot.
    closeModal();
    lastAnalyzedItem = null;
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

  // Modal-dismiss is a special case: the backdrop carries the data-action,
  // but clicks bubbled up from inside .modal-content should NOT dismiss.
  const dismissTarget = target.closest('[data-action="modal-dismiss"]');
  if (dismissTarget) {
    // If the click originated inside .modal-content (and not on the close
    // button itself), don't dismiss.
    const isCloseBtn = (target as HTMLElement).closest(".modal-close");
    if (!isCloseBtn) {
      const insideContent = (target as HTMLElement).closest(".modal-content");
      if (insideContent) return;
    }
    closeModal();
    return;
  }

  const actionEl = target.closest("[data-action]") as HTMLElement | null;
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "analyze") {
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
