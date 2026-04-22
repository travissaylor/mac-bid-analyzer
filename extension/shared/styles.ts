// Shadow-DOM CSS for the inline badge and the full-screen modal.
// Both stylesheets are loaded into the SAME shadow root by the entry point,
// so class names must be disjoint between BADGE_STYLES and MODAL_STYLES.
//
// Mobile positioning is handled in the entry-point content script via
// window.matchMedia, not via CSS, because the host element is outside the
// shadow DOM. The entry point sets `top`/`bottom` inline on the host based
// on the viewport breakpoint.

export const BADGE_STYLES = `
  .card {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    background: #fff;
    color: #222;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    padding: 10px 12px;
    min-width: 210px;
    max-width: 280px;
    position: relative;
  }
  .card.slide-in { animation: mba-slide-in 180ms ease-out; }
  @keyframes mba-slide-in {
    from { transform: translateX(16px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* Card chrome (minimize + overflow menu) */
  .card-chrome {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    margin: -6px -6px 4px -6px;
  }
  .chrome-btn {
    background: transparent;
    color: #888;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .chrome-btn:hover { background: #f0f0f0; color: #222; }
  .overflow-wrap { position: relative; }
  .overflow-menu {
    display: none;
    position: absolute;
    top: 26px;
    right: 0;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    padding: 6px 0;
    min-width: 150px;
  }
  .overflow-menu[data-open="true"] { display: block; }
  .overflow-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    padding: 4px 12px 6px;
  }
  .overflow-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: transparent;
    color: #222;
    text-align: left;
    padding: 6px 12px;
    border-radius: 0;
    font-size: 13px;
  }
  .overflow-item:hover { background: #f5f5f5; }
  .overflow-check { color: #1976D2; visibility: hidden; width: 12px; display: inline-block; }
  .overflow-item[data-current="true"] .overflow-check { visibility: visible; }


  /* Minimized chip */
  .chip-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #fff;
    color: #222;
    border: 1px solid #e0e0e0;
    border-radius: 999px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    padding: 6px 12px 6px 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    animation: mba-slide-in 180ms ease-out;
  }
  .chip-btn:hover { background: #fafafa; }
  .chip-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #bdbdbd;
    flex-shrink: 0;
  }
  .chip-btn.good-deal { border-color: #4CAF50; color: #2E7D32; }
  .chip-btn.good-deal .chip-dot { background: #4CAF50; }
  .chip-btn.over-max { border-color: #F44336; color: #C62828; }
  .chip-btn.over-max .chip-dot { background: #F44336; }
  .chip-btn.error { border-color: #ff9800; color: #b26a00; }
  .chip-btn.error .chip-dot { background: #ff9800; }
  .chip-label { line-height: 1; }

  /* Hidden-state side tab — uses fixed positioning to escape the host's
     right:16px offset and anchor flush to the viewport's right edge. */
  .side-tab-host {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .side-tab-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #fff;
    color: #666;
    border: 1px solid #e0e0e0;
    border-right: none;
    border-radius: 10px 0 0 10px;
    box-shadow: -4px 4px 14px rgba(0, 0, 0, 0.12);
    padding: 10px 6px;
    width: 24px;
    min-height: 56px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    animation: mba-slide-in 180ms ease-out;
  }
  .side-tab-btn:hover { background: #fafafa; color: #222; padding-right: 8px; }
  .side-tab-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #bdbdbd;
  }
  .side-tab-arrow { font-size: 16px; line-height: 1; color: inherit; }
  .side-tab-btn.good-deal .side-tab-dot { background: #4CAF50; }
  .side-tab-btn.over-max .side-tab-dot { background: #F44336; }
  .side-tab-btn.error .side-tab-dot { background: #ff9800; }
  .card.good-deal { border-color: #4CAF50; background: #f3faf4; }
  .card.over-max { border-color: #F44336; background: #fdf4f4; }
  .card.error { border-color: #ff9800; background: #fff8e1; }
  .title { font-weight: 600; font-size: 12px; color: #555; margin-bottom: 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .col { display: flex; flex-direction: column; }
  .label {
    color: #666;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .amount {
    font-weight: 700;
    font-size: 20px;
    color: #111;
    margin-top: 2px;
    line-height: 1.1;
  }
  .card.good-deal .amount { color: #2E7D32; }
  .card.over-max .amount { color: #C62828; }
  .hint { color: #666; font-size: 12px; line-height: 1.35; }
  .error-msg { color: #b71c1c; font-size: 12px; line-height: 1.35; }
  button {
    font-family: inherit;
    border: none;
    cursor: pointer;
    border-radius: 6px;
    font-size: 12px;
    padding: 6px 12px;
  }
  button.primary { background: #1976D2; color: #fff; }
  button.primary:hover { background: #1565C0; }
  button.secondary { background: #f0f0f0; color: #333; }
  button.secondary:hover { background: #e0e0e0; }
  button.secondary.small { margin-top: 8px; font-size: 11px; padding: 4px 8px; }
  button.icon {
    background: transparent;
    color: #1976D2;
    padding: 4px 6px;
    font-size: 16px;
    line-height: 1;
  }
  button.icon:hover { background: #e3f2fd; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ddd;
    border-top-color: #1976D2;
    border-radius: 50%;
    animation: mba-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .spinner-row { display: flex; align-items: center; gap: 8px; }
  @keyframes mba-spin { to { transform: rotate(360deg); } }
`;

export const MODAL_STYLES = `
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #333;
    -webkit-font-smoothing: antialiased;
  }
  .modal-content {
    position: relative;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    width: 100%;
    max-width: 480px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 20px;
    box-sizing: border-box;
  }
  .modal-content * { box-sizing: border-box; }
  .modal-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: #666;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    border-radius: 6px;
    padding: 0;
  }
  .modal-close:hover { background: #f0f0f0; color: #222; }

  @media (max-width: 768px) {
    .modal-backdrop {
      padding: 0;
      align-items: stretch;
      justify-content: stretch;
    }
    .modal-content {
      max-width: none;
      max-height: 100vh;
      height: 100vh;
      border-radius: 0;
      padding: 16px;
    }
  }

  /* Analysis results styling */
  .analysis-header {
    margin-bottom: 12px;
    padding-right: 32px; /* avoid collision with close button */
  }
  .product-name {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 4px;
  }
  .lot-meta {
    font-size: 12px;
    color: #666;
  }
  .max-bid-banner {
    padding: 10px 12px;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 14px;
    font-weight: 600;
  }
  .max-bid-banner .label {
    font-weight: 400;
    font-size: 12px;
    display: block;
    margin-bottom: 2px;
  }
  .max-bid-banner .bid-value {
    font-size: 20px;
  }
  .max-bid-banner.good-deal {
    background-color: #e8f5e9;
    color: #2e7d32;
    border: 1px solid #a5d6a7;
  }
  .max-bid-banner.over-max {
    background-color: #ffebee;
    color: #c62828;
    border: 1px solid #ef9a9a;
  }
  .max-bid-banner.neutral {
    background-color: #f5f5f5;
    color: #555;
    border: 1px solid #ddd;
  }
  .deal-score {
    font-size: 12px;
    font-weight: 400;
    margin-top: 4px;
  }
  .manual-review-warning {
    background-color: #fff3e0;
    color: #e65100;
    border: 1px solid #ffcc80;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .section {
    margin-bottom: 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    padding: 8px 12px;
    background-color: #fafafa;
    border-bottom: 1px solid #e0e0e0;
  }
  .section-body {
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.5;
  }
  .section-body .row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
  }
  .section-body .row .label {
    color: #666;
  }
  .section-body .row .value {
    font-weight: 500;
    text-align: right;
  }
  .price-range {
    display: flex;
    justify-content: space-between;
    text-align: center;
    margin: 4px 0;
  }
  .price-range .price-col {
    flex: 1;
  }
  .price-range .price-col .price-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
  }
  .price-range .price-col .price-value {
    font-size: 14px;
    font-weight: 600;
  }
  .reasoning-text {
    font-size: 12px;
    color: #555;
    font-style: italic;
    margin-top: 6px;
    line-height: 1.4;
  }
  .comparable-item {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 2px 0;
    color: #555;
  }
  .image-flag {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
  }
  .severity-badge {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .severity-high {
    background-color: #ffcdd2;
    color: #b71c1c;
  }
  .severity-medium {
    background-color: #fff9c4;
    color: #f57f17;
  }
  .severity-low {
    background-color: #e0e0e0;
    color: #616161;
  }
  .source-footer {
    font-size: 11px;
    color: #999;
    text-align: right;
    margin-top: 8px;
  }
  #feedback-section {
    margin-top: 12px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    background-color: #fafafa;
  }
  #feedback-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #666;
    margin-bottom: 6px;
  }
  #feedback-textarea {
    width: 100%;
    min-height: 64px;
    font-family: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    resize: vertical;
    box-sizing: border-box;
  }
  #feedback-actions {
    margin-top: 8px;
  }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    margin-left: 6px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    background-color: #e3f2fd;
    color: #1565c0;
    border: 1px solid #90caf9;
    vertical-align: middle;
  }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s;
    font-family: inherit;
  }
  .btn-primary {
    background-color: #4CAF50;
    color: #fff;
  }
  .btn-primary:hover {
    background-color: #43a047;
  }
  .btn-secondary {
    background-color: #757575;
    color: #fff;
  }
  .btn-secondary:hover {
    background-color: #616161;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
