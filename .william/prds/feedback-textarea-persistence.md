# PRD: Persist and Restore Feedback Notes in Chrome Extension

## Introduction

When a user submits correction/context notes for a lot in the chrome extension side panel, those notes are not restored into the textarea when the user returns to the same lot. This happens both when navigating away and back, and when closing and reopening the side panel. The "Corrected" pill displays correctly, but the textarea is empty — making it look like no feedback was saved. Additionally, clearing the textarea and re-analyzing should explicitly clear saved feedback.

## Goals

- Restore previously submitted feedback notes into the textarea when returning to an analyzed lot
- Support both navigation scenarios: navigate-away-and-back, and close/reopen side panel
- Allow users to clear feedback by submitting an empty textarea
- No regressions to the existing analyze, re-analyze, or "Corrected" pill flows

## User Stories

### US-001: Restore feedback on lot return via navigation

**Description:** As a user, I want my previously submitted correction notes to appear in the textarea when I navigate away from a lot and then return to it, so that I can see and edit my prior feedback.

**Acceptance Criteria:**

- [ ] Submit feedback for a lot, navigate to a different lot (or non-lot page), then return to the original lot
- [ ] The textarea is populated with the previously submitted feedback text
- [ ] The "Corrected" pill is visible
- [ ] The "Re-analyze" button is shown (not "Analyze")
- [ ] Typecheck and lint pass

### US-002: Restore feedback on side panel reopen

**Description:** As a user, I want my previously submitted correction notes to appear in the textarea when I close and reopen the side panel on the same lot page, so that my feedback persists across panel sessions.

**Acceptance Criteria:**

- [ ] Submit feedback for a lot, close the side panel, reopen it while still on the same lot page
- [ ] The textarea is populated with the previously submitted feedback text
- [ ] The "Corrected" pill is visible
- [ ] Typecheck and lint pass

### US-003: Clear feedback via empty submission

**Depends on:** US-001

**Description:** As a user, I want to clear my feedback by emptying the textarea and clicking "Save & re-analyze", so that the lot reverts to an uncorrected state.

**Acceptance Criteria:**

- [ ] With existing feedback, clear the textarea and click "Save & re-analyze"
- [ ] After re-analysis, the textarea is empty
- [ ] The "Corrected" pill is no longer visible
- [ ] Returning to the lot later still shows an empty textarea (feedback was cleared server-side)
- [ ] Typecheck and lint pass

## Functional Requirements

- FR-1: When `GET /api/lot/:lotId` returns an analyzed item with a non-null `user_feedback` field, the feedback textarea must be populated with that value before or when results are displayed
- FR-2: When `GET /api/lot/:lotId` returns an analyzed item with a null `user_feedback` field, the textarea must remain empty
- FR-3: When the user submits an empty textarea via "Save & re-analyze", the request must send `user_feedback` as an empty string (or null) to signal clearing
- FR-4: After a re-analysis that clears feedback, the "Corrected" pill must not be shown
- FR-5: The textarea must also be repopulated after a `POST /api/analyze` response that includes `user_feedback` (so the value persists through re-analysis cycles without a page reload)

## Non-Goals

- No changes to the backend storage or API contract (the backend already stores and returns `user_feedback`)
- No offline/local caching of feedback — the backend remains the source of truth
- No changes to the feedback textarea UI design or placement

## Technical Considerations

- The load path in `sidepanel.js` `handleLotDetected()` (lines 499-503) already attempts to populate from `cached.user_feedback` — investigate whether the issue is that the backend response doesn't include the field, or a frontend ordering/timing bug
- The `POST /api/analyze` response should also be checked — after re-analysis, the returned data should include `user_feedback` so subsequent `showResults()` calls can keep the textarea in sync
- The `runAnalysis()` function (line 449) calls `hideResults()` which hides the feedback section but does not clear the textarea — verify this doesn't conflict with post-analysis population

## Success Metrics

- Previously submitted feedback is visible in the textarea 100% of the time when returning to an analyzed lot
- Clearing feedback via empty submission removes the "Corrected" pill and persists the cleared state

## Open Questions

- Is the root cause a frontend issue (textarea not populated from a valid response) or a backend issue (`user_feedback` not included in the GET or POST response)? Investigation during implementation will determine this.
