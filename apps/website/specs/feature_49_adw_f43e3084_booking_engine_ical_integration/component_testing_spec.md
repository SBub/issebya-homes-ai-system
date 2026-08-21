# Component Testing Spec: Booking Engine with iCal Integration

## Test Scope

### In Scope

- `BookingEngine` - Main booking engine component (client component)
- `BookingCalendar` - Calendar date selection component (client component)
- `BookingEngineCollapsed` - Collapsed state display (client component)
- `BookingEngineExpanded` - Expanded state with calendar (client component)

## New Component Tests

### Test Files to Create

- `src/ui/BookingEngine.browser.test.tsx` - Tests for main booking engine component
- `src/ui/BookingCalendar.browser.test.tsx` - Tests for calendar component
- `src/ui/BookingEngineCollapsed.browser.test.tsx` - Tests for collapsed state
- `src/ui/BookingEngineExpanded.browser.test.tsx` - Tests for expanded state

**Note**: Only synchronous client components. BookingInfoBlock is tested via E2E as it involves integration with the full page.

### Coverage Areas

1. **BookingEngine**: State management, expand/collapse toggling, date selection flow, loading/error states
2. **BookingCalendar**: Date rendering, month navigation, date selection logic, blocked date display, keyboard navigation
3. **BookingEngineCollapsed**: Date display formatting, expand trigger, book button state
4. **BookingEngineExpanded**: Calendar integration, person count input, close/book actions

### Test Cases

#### `BookingEngine`

**Purpose**: Orchestrate booking date selection with expand/collapse states

**User Interactions to Test**:

- Should render loading state while fetching availability
- Should render error message when availability fetch fails
- Should render collapsed state with default dates after loading
- Should expand when clicking date in collapsed state
- Should collapse when clicking close button in expanded state
- Should handle date selection and update state
- Should call onBook callback with correct dates and person count
- Should display partial error message when some feeds fail but dates are available

**Accessibility to Test**:

- Loading and error messages should be readable by screen readers
- Date selection interactions should work with keyboard
- Focus management when expanding/collapsing

**Edge Cases**:

- No available dates in next 90 days (show error)
- All iCal feeds fail (show error)
- Some feeds fail but others succeed (show dates with warning)

#### `BookingCalendar`

**Purpose**: Display monthly calendar with date selection and availability

**User Interactions to Test**:

- Should render current month by default
- Should navigate to previous month when clicking prev button
- Should navigate to next month when clicking next button
- Should show day names (Su, Mo, Tu, We, Th, Fr, Sa)
- Should render dates for entire month including outside-month dates
- Should apply blocked styling to past dates
- Should apply blocked styling to dates in blocked ranges
- Should apply available styling to unblocked future dates
- Should handle first date click (set check-in)
- Should handle second date click (set check-out if after check-in)
- Should reset to new check-in if clicked date is before current check-in
- Should show selected check-in date with special styling
- Should show selected check-out date with special styling
- Should show range between check-in and check-out with special styling

**Accessibility to Test**:

- Keyboard navigation with arrow keys to move between dates
- Enter key to select date
- ARIA labels for all dates (format: "MMMM d, yyyy")
- ARIA selected state for check-in and check-out dates
- Disabled dates should have tabIndex=-1
- Available dates should have tabIndex=0
- Focus outline visible on keyboard focus

**Edge Cases**:

- Selecting blocked date should not change state
- Selecting past date should not change state
- Month boundary: dates from previous/next month shown but greyed out
- Selected range spans multiple months (verify visual continuity)

#### `BookingEngineCollapsed`

**Purpose**: Display selected dates in compact format with expand and book actions

**User Interactions to Test**:

- Should display check-in date in formatted text (MMM d, yyyy)
- Should display check-out date in formatted text (MMM d, yyyy)
- Should show "Select date" when no dates selected
- Should call onExpand when clicking check-in button
- Should call onExpand when clicking check-out button
- Should call onBook when clicking book button
- Should disable book button when no dates selected
- Should enable book button when both dates are selected

**Accessibility to Test**:

- Date buttons should have aria-label for screen readers
- Book button should have aria-label
- Disabled book button should be announced as disabled

**Edge Cases**:

- Null check-in date displays "Select date"
- Null check-out date displays "Select date"
- Book button disabled when only check-in selected (no check-out)

#### `BookingEngineExpanded`

**Purpose**: Show calendar, person selector, and booking controls

**User Interactions to Test**:

- Should render BookingCalendar component
- Should display selected check-in and check-out dates at top
- Should show "Select date" when no dates selected
- Should render person count input with default value 1
- Should update person count when user types valid number (1-2)
- Should not allow person count less than 1
- Should not allow person count greater than 2
- Should call onClose when clicking close button
- Should call onBook when clicking book button
- Should disable book button when no dates selected
- Should enable book button when both dates are selected
- Should pass date selection to calendar component

**Accessibility to Test**:

- Close button should have aria-label
- Person count input should have label and aria-label
- Book button should have aria-label
- Calendar should be keyboard navigable

**Edge Cases**:

- Person count input with non-integer value (should not update)
- Person count input with 0 or negative (should not update)
- Person count input with value > 2 (should not update)
- Book button disabled when only one date selected

### Mocking Strategy

1. **Mock `useBookingDates` hook** in `BookingEngine` tests:
   - Use `vi.mock('@/hooks/useBookingDates')` to mock the hook
   - Return controlled state values for testing different scenarios
   - Mock functions: `setCheckIn`, `setCheckOut`, `validateRange`, `resetDates`

2. **Mock `BookingCalendar` component** in `BookingEngineExpanded` tests (optional):
   - Use `vi.mock('./BookingCalendar')` to test expanded state without full calendar rendering
   - Verify that calendar receives correct props

3. **Mock `fetch` for availability API** in integration tests if needed:
   - Use `vi.spyOn(global, 'fetch')` to mock API responses
   - Return different availability scenarios (no dates, some blocked, all blocked)

4. **No mocking needed** for `BookingCalendar`, `BookingEngineCollapsed`, `BookingEngineExpanded` individual component tests - test with real implementations and controlled props.

## Integration Tests (if applicable)

### Test Files to Create

`src/ui/BookingEngine.integration.browser.test.tsx` - Integration test for complete booking flow

### Integration Pattern

**Pattern B (Full Integration)**: All children real (BookingCalendar, BookingEngineCollapsed, BookingEngineExpanded), only mock external APIs (fetch for availability).

### Components Under Integration

- **Real (not mocked)**: BookingEngine, BookingCalendar, BookingEngineCollapsed, BookingEngineExpanded
- **Mocked**: fetch API for availability endpoint

### State Flows to Test

- User expands booking engine → calendar is visible → user selects dates → user books
- User sees collapsed state with default dates → expands → changes dates in calendar → collapses → sees updated dates
- User encounters error fetching availability → error message displayed → no dates selectable
- User selects check-in → selects blocked date for check-out → calendar resets and shows only check-in

### Selective Mocking Strategy

Mock the `fetch` API to return controlled availability data:

```typescript
vi.spyOn(global, "fetch").mockImplementation((url) => {
  if (url.includes("/api/availability?room=room1")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        blockedDates: [
          {
            start: "2026-02-20T00:00:00.000Z",
            end: "2026-02-22T00:00:00.000Z",
          },
          {
            start: "2026-02-25T00:00:00.000Z",
            end: "2026-02-27T00:00:00.000Z",
          },
        ],
      }),
    } as Response);
  }
  return Promise.reject(new Error("Not found"));
});
```

This allows testing the complete user flow with real component interactions while controlling availability data.

## Failed/Broken Tests (if applicable)

**To discover failed/broken component tests, run**: `yarn test:browser` or `npx vitest --project=browser --browser.headless`

No existing component tests should be broken by this feature, as it adds new components without modifying existing ones.

If any tests fail during implementation, document them here with:

- Test file path
- Test name
- Why it failed
- How to fix it

### Validation Command

`yarn test:browser` or `npx vitest --project=browser --browser.headless`

**Note**: All component tests (new and fixed) must pass before the feature is considered complete.
