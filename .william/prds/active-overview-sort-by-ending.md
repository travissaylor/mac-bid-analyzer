# PRD: Sort Active Overview by Auction End Time

## 1. Introduction/Overview

The `/active` command in the Telegram bot currently sorts items by deal score (best deals first). This makes it hard to act on auctions that are about to close. This feature changes the active overview to sort items by ending soonest and displays how much time remains before each auction closes, with an urgency indicator for auctions ending within one hour.

## 2. Goals

- Sort the active overview by auction end time (soonest first) so users can prioritize time-sensitive bids
- Display a human-readable relative time remaining (e.g., "2h 15m") for each active item
- Visually highlight auctions ending within 1 hour so they stand out

## 3. User Stories

### US-001: Add time remaining to ItemDisplayData

**Description:** As a developer, I want `expected_close_date` exposed in `ItemDisplayData` so that renderers can display and sort by time remaining.

**Acceptance Criteria:**

- [ ] `ItemDisplayData` includes an `expectedCloseDate: string | null` field
- [ ] `resolveDisplayData()` passes through `expected_close_date` from `AnalyzedItem`
- [ ] Typecheck passes

### US-002: Sort active overview by ending soonest

**Description:** As a mac.bid user, I want the active overview sorted by ending soonest so that I can quickly see which auctions need immediate attention.

**Acceptance Criteria:**

- [ ] Both `plainText.activeOverview` and `telegramHtml.activeOverview` sort items by `expectedCloseDate` ascending (soonest first)
- [ ] Items with no `expectedCloseDate` appear at the bottom of the list
- [ ] Items with no `expectedCloseDate` are sorted among themselves by deal score (existing behavior as fallback)
- [ ] Typecheck passes

### US-003: Display relative time remaining

**Description:** As a mac.bid user, I want to see how soon each auction ends (e.g., "2h 15m") so that I know how much time I have to act.

**Acceptance Criteria:**

- [ ] Each item in the active overview displays time remaining in compact relative format (e.g., "2h 15m", "45m", "3d 6h")
- [ ] Items with no `expectedCloseDate` display "End time unknown" or similar
- [ ] Items where the close date has already passed display "Ended" or similar
- [ ] The time remaining is calculated relative to the current time when the overview is rendered
- [ ] Typecheck passes

### US-004: Urgency indicator for auctions ending within 1 hour

**Description:** As a mac.bid user, I want auctions ending within 1 hour to be visually highlighted so that I don't miss time-sensitive bidding opportunities.

**Acceptance Criteria:**

- [ ] Items ending within 60 minutes display a fire emoji or similar urgency indicator next to the time remaining
- [ ] The urgency indicator appears in both plain text and Telegram HTML renderers
- [ ] Items ending in more than 1 hour do not show the urgency indicator
- [ ] Items with no close date do not show the urgency indicator
- [ ] Typecheck passes

## 4. Functional Requirements

- **FR-1:** `ItemDisplayData` must include `expectedCloseDate: string | null`, populated from `AnalyzedItem.expected_close_date`.
- **FR-2:** A `formatTimeRemaining(closeDate: string): string` helper must be implemented that returns compact relative time strings: days+hours for >24h (e.g., "3d 6h"), hours+minutes for >1h (e.g., "2h 15m"), minutes only for <1h (e.g., "45m"), and "Ended" for past dates.
- **FR-3:** The `activeOverview` method in both `plainText` and `telegramHtml` renderers must sort items by `expectedCloseDate` ascending (soonest first), with null dates sorted to the bottom. Among null-date items, sort by deal score descending (existing behavior).
- **FR-4:** Each item in the active overview must display the time remaining on a dedicated line, using the output of `formatTimeRemaining`.
- **FR-5:** Items ending within 60 minutes must display a visual urgency indicator (e.g., a fire emoji) prepended to the time remaining line.
- **FR-6:** Items with no `expectedCloseDate` must display "End time unknown" instead of a countdown.
- **FR-7:** No changes to the sync API or data fetching logic. `expected_close_date` is already populated at analysis time.

## 5. Non-Goals (Out of Scope)

- No changes to the individual item summary or detail views (only the active overview is affected)
- No changes to the table/CLI view sorting
- No syncing or refreshing of `expected_close_date` from the live API
- No push notifications or alerts when auctions are about to end
- No configurable urgency threshold (hardcoded to 1 hour)
- No timezone conversion or user-specific time formatting

## 6. Edge Cases & Error Handling

- **Null close date:** Items with `expected_close_date === null` sort to the bottom and show "End time unknown" instead of a countdown.
- **Past close date:** If `expected_close_date` is in the past but `is_open` is still 1 (stale data), display "Ended" as the time remaining. Do not show the urgency indicator.
- **All items have null dates:** Falls back to deal-score sorting for the entire list (effectively current behavior).
- **Close date exactly 60 minutes away:** Should show the urgency indicator (threshold is inclusive: <= 60 minutes).
- **Malformed date string:** If `expected_close_date` cannot be parsed, treat it as null (unknown end time).

## 7. Technical Considerations

- The `expected_close_date` field already exists in the `analyzed_items` table schema (`src/db.ts:65`) and the `AnalyzedItem` interface (`src/db.ts:18`).
- The `resolveDisplayData` function in `src/format.ts` needs to pass through the field.
- The `formatTimeRemaining` helper should be a pure function for easy unit testing.
- Time calculations should use `Date` arithmetic (no external libraries needed).
- The sort comparison function should handle null values explicitly before comparing dates.

## 8. Success Metrics

- The active overview displays items in end-time order with visible countdowns
- Urgency indicators appear correctly for items ending within 1 hour
- All existing format tests continue to pass
- New unit tests cover `formatTimeRemaining` with various inputs (future dates at different ranges, past dates, null, malformed strings)

## 9. Open Questions

- None at this time. All requirements have been clarified.
