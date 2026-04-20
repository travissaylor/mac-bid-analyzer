// Small "collapsed" badge card content. Each renderer returns the variant
// (used by the entry point as the card's class suffix: "good-deal", "over-max",
// "error", or empty) and the inner HTML, so the entry point can apply both
// atomically. Pure — no DOM, no chrome.*.

import type { AnalyzedItem } from "./types";
import { escapeHtml } from "./display";

export interface BadgeContent {
  variant: string;
  html: string;
}

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
