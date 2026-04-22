// Small "collapsed" badge card content. Each renderer returns the variant
// (used by the entry point as the card's class suffix: "good-deal", "over-max",
// "error", or empty) and the inner HTML, so the entry point can apply both
// atomically. Pure — no DOM, no chrome.*.

import type { AnalyzedItem } from "./types";
import { escapeHtml } from "./display";
import type { CardDefaultState } from "./preferences";

export interface BadgeContent {
  variant: string;
  html: string;
}

// Static chrome (minimize button + overflow menu) prepended above every card
// body. The overflow menu's "checked" radio is updated separately via
// data-state attribute on the menu container.
export const BADGE_CHROME_HTML = `
  <div class="card-chrome">
    <button class="chrome-btn" data-action="minimize" title="Minimize" aria-label="Minimize">&minus;</button>
    <div class="overflow-wrap">
      <button class="chrome-btn" data-action="overflow-toggle" title="Default state" aria-label="Default state">&#8943;</button>
      <div class="overflow-menu" data-open="false" role="menu">
        <div class="overflow-title">Default state</div>
        <button class="overflow-item" data-action="set-default" data-state="expanded" role="menuitemradio">
          <span class="overflow-check">&#10003;</span><span>Expanded</span>
        </button>
        <button class="overflow-item" data-action="set-default" data-state="minimized" role="menuitemradio">
          <span class="overflow-check">&#10003;</span><span>Minimized</span>
        </button>
        <button class="overflow-item" data-action="set-default" data-state="hidden" role="menuitemradio">
          <span class="overflow-check">&#10003;</span><span>Hidden</span>
        </button>
      </div>
    </div>
  </div>
`;

export function renderChip(variant: string, label: string): string {
  const safeLabel = escapeHtml(label);
  const variantClass = variant ? ` ${variant}` : "";
  return `
    <button class="chip-btn${variantClass}" data-action="restore" title="Show analyzer" aria-label="Show analyzer (${safeLabel})">
      <span class="chip-dot"></span>
      <span class="chip-label">${safeLabel}</span>
    </button>
  `;
}

export function renderSideTab(variant: string): string {
  const variantClass = variant ? ` ${variant}` : "";
  return `
    <button class="side-tab-btn${variantClass}" data-action="restore" title="Show analyzer" aria-label="Show analyzer">
      <span class="side-tab-dot"></span>
      <span class="side-tab-arrow">&#8249;</span>
    </button>
  `;
}

// Short label for the chip given an analyzed item (or null if not analyzed).
export function chipLabelFor(item: AnalyzedItem | null): string {
  if (!item) return "MB";
  const max = item.recommended_max_bid;
  if (max === null || max === undefined) return "?";
  const n = Number(max);
  if (!Number.isFinite(n)) return "?";
  if (n <= 0) return "—";
  if (n >= 1000) return `$${Math.round(n / 100) / 10}k`;
  return `$${Math.round(n)}`;
}

// Re-export so callers can use a single import for state types.
export type { CardDefaultState };

export function renderChecking(): BadgeContent {
  return {
    variant: "",
    html: `<div class="spinner-row"><div class="spinner"></div><span class="hint">Checking analysis…</span></div>`,
  };
}

export function renderAnalyzing(): BadgeContent {
  return {
    variant: "",
    html: `<div class="spinner-row"><div class="spinner"></div><span class="hint">Analyzing lot…</span></div>`,
  };
}

export function renderNotAnalyzed(): BadgeContent {
  return {
    variant: "",
    html: `
    <div class="title">mac.bid Analyzer</div>
    <button class="primary" data-action="analyze">Analyze now</button>
  `,
  };
}

export function renderAnalyzed(item: AnalyzedItem): BadgeContent {
  const maxBid = item.recommended_max_bid;
  const currentBid = Number(item.current_bid) || 0;
  let valueHtml: string;
  let variant = "";
  if (maxBid === null || maxBid === undefined) {
    valueHtml = `<span class="amount">N/A</span>`;
  } else if (Number(maxBid) <= 0) {
    valueHtml = `<span class="amount">Not worth it</span>`;
    variant = "over-max";
  } else {
    const formatted = `$${Number(maxBid).toFixed(2)}`;
    valueHtml = `<span class="amount">${formatted}</span>`;
    variant = currentBid <= Number(maxBid) ? "good-deal" : "over-max";
  }
  return {
    variant,
    html: `
    <div class="row">
      <div class="col">
        <div class="label">Recommended max bid</div>
        ${valueHtml}
      </div>
      <button class="icon" data-action="details" title="Open full analysis">&#8505;</button>
    </div>
    <button class="secondary small" data-action="reanalyze">Re-analyze</button>
  `,
  };
}

export function renderError(message: string): BadgeContent {
  return {
    variant: "error",
    html: `
    <div class="error-msg">${escapeHtml(message)}</div>
    <button class="secondary small" data-action="analyze">Retry</button>
  `,
  };
}

export function renderNoToken(): BadgeContent {
  return {
    variant: "",
    html: `
    <div class="title">mac.bid Analyzer</div>
    <div class="hint">API token is not configured. Rebuild the extension with a valid token in <code>.env</code>.</div>
  `,
  };
}
