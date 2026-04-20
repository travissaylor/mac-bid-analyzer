// Full-screen modal markup. Composes the existing `renderResults` body with
// a backdrop, a close button, and the feedback section. Uses `data-action`
// attributes so the entry point can dispatch click handlers cleanly without
// caring about element identity.

import type { DisplayData } from "./types";
import { escapeHtml, renderResults } from "./display";

/**
 * Render the full modal as an HTML string. The entry point inserts this
 * into the same shadow root that hosts the badge (so MODAL_STYLES applies)
 * and wires up clicks via event delegation on `data-action` attributes:
 *
 * - `data-action="modal-dismiss"` — close the modal (backdrop or X button)
 * - `data-action="feedback-submit"` — re-analyze with the textarea contents
 *
 * Click events on the backdrop should be checked for `event.target ===
 * backdrop` to avoid dismissing when clicking inside the content card.
 */
export function renderModal(data: DisplayData): string {
  return `
    <div class="modal-backdrop" data-action="modal-dismiss">
      <div class="modal-content">
        <button class="modal-close" type="button" data-action="modal-dismiss" aria-label="Close">&times;</button>
        <div class="modal-results">${renderResults(data)}</div>
        <div id="feedback-section">
          <label id="feedback-label" for="feedback-textarea">Correction / context</label>
          <textarea id="feedback-textarea" placeholder="Add notes to correct or guide the analysis (e.g. 'this is actually a 2nd-gen model', 'box shows water damage')">${escapeHtml(data.userFeedback ?? "")}</textarea>
          <div id="feedback-actions">
            <button id="feedback-submit" class="btn btn-primary" type="button" data-action="feedback-submit">Save &amp; re-analyze</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
