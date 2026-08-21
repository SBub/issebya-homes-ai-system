# Feature: Booking Engine with iCal Integration

## Metadata

issue_number: `49`
adw_id: `f43e3084`
issue_json: `{"number":49,"title":"Develop booking engine","body":"Develop a booking engine (instead of 'Book on Airbnb button"). You should be able to select in one go check in day and check out day. The booking engine should integrate with iCal, i.e. room 1 calendar https://www.airbnb.com/calendar/ical/1424633715489915166.ics?t=ff640aed3a604c3aadd5a66bf074eeeb, https://ical.booking.com/v1/export?t=f4d7c087-b9c7-40e9-9df6-e3a10697e0c1 room 2 calendar https://www.airbnb.com/calendar/ical/1507883205063503481.ics?t=a2a6a904567f41d88df17f0f6ec20b98, https://ical.booking.com/v1/export/t/9614a995-523b-48f9-8cb4-64f52eebaa42.ics, http://www.vrbo.com/icalendar/f1c545555adb4c4984d582e1468e7c6b.ics. Consider booked dates from these calendars for each room.  \nAs check in and check out dates always select first 2 nights available to book. When you click on check in or check out the booking engine slides down. \n\nPerson field in the booking engine is an input and can be 1 or 2, default is 1.   If the booking engine view is open, the book button next to the check-in and check-out date should not be there. And the only book button will be in the booking engine. However, if the booking engine is closed, you can close it by pressing the close button, then the book button appears next to the check-in and check-out date. CTA of "Book" button outside of booking engine - show booking engine if it's closed.  \nExample of available and booked dates: If room is booked from 02.03-05.03, 02, 03, 04 - are disabled, 05.03 is enabled for somebody else to book, if there is another booking 07.03-10.03, then 05, 06 and 10 are available for booking, 07, 08, 09 - isn't. User won't be able to select 01.03 - 06.03 for booking. \n\nMockup\n- booking engine view is closed: \n<img width=\"353\" height=\"426\" alt=\"Image\" src=\"https://github.com/user-attachments/assets/84bee94c-00f8-4c11-8b82-3b4e4fe9fc39\" />\n- booking engine view is open \n<img width=\"347\" height=\"456\" alt=\"Image\" src=\"https://github.com/user-attachments/assets/db09af15-c4bb-4532-a422-a4f4d7648e0a\" />\n\nExample of available and booked dates (adopt to the current color palette)\n<img width=\"493\" height=\"254\" alt=\"Image\" src=\"https://github.com/user-attachments/assets/63d60e5c-47d4-4dfb-957c-6a87bee8786c\" />\n\nExample of date range selection (adopt to the current color palette)\n<img width=\"492\" height=\"257\" alt=\"Image\" src=\"https://github.com/user-attachments/assets/eb511cd8-ccc9-41eb-9c57-5c1a13bc6d17\" />"}`

## Feature Description

Replace the "Book on Airbnb" button with an interactive booking engine that allows users to:

- Select check-in and check-out dates using a calendar interface
- View available and booked dates in real-time by integrating with iCal feeds from Airbnb, Booking.com, and VRBO
- See the first 2 available nights pre-selected by default
- Specify number of persons (1 or 2, default 1)
- Toggle between a collapsed state showing dates and expanded state showing the full booking calendar
- Book directly through the website instead of redirecting to external platforms

The booking engine replaces the existing Airbnb button on room pages (Room 1 and Room 2), providing a seamless booking experience that respects availability from all external booking platforms.

## User Story

As a potential guest
I want to select my check-in and check-out dates directly on the website and see real-time availability
So that I can quickly book a room without being redirected to external platforms and know which dates are actually available

## Problem Statement

Currently, users must click a "Book on Airbnb" button which redirects them to an external platform. This creates friction in the booking process and doesn't provide immediate visibility into available dates. Users cannot see which dates are booked across multiple platforms (Airbnb, Booking.com, VRBO) without visiting each platform separately.

## Solution Statement

Implement an integrated booking engine that:

1. Fetches and parses iCal feeds from Airbnb, Booking.com, and VRBO to determine booked dates for each room
2. Displays an interactive calendar showing available and unavailable dates using the existing color palette
3. Defaults to the first 2 consecutive available nights
4. Allows toggling between collapsed (showing selected dates + "Book" button) and expanded (showing full calendar) states
5. Validates date selections to prevent booking unavailable dates
6. Maintains responsive design across mobile and desktop

The booking engine will use Radix UI primitives for all interactive components (calendar, dialog, popover) to ensure accessibility and maintain consistent styling with Tailwind CSS.

## Relevant Files

### Existing Files to Modify

- **`src/app/(main)/booking/ui/BookingInfoBlock.tsx`** - Replace `AirbnbButton` with the new `BookingEngine` component for room types. This is the main component that displays booking information and currently shows the Airbnb button.

- **`src/app/(main)/booking/ui/BookingContent.tsx`** - Update to pass room-specific iCal URLs to the BookingInfoBlock component for Room 1 and Room 2.

- **`src/app/(main)/booking/ui/AirbnbButton.tsx`** - Will be replaced by the BookingEngine component, can be removed.

- **`src/types/booking.ts`** - Add new types for iCal events, blocked dates, and booking engine state.

- **`src/app/globals.css`** - Add custom CSS for calendar date states (available, booked, selected, range) that align with the current color palette (#f0eeea background, #000000 foreground).

### New Files

- **`src/lib/ical-parser.ts`** - Utility functions to fetch and parse iCal feeds, extract booked date ranges, and merge overlapping bookings.

- **`src/lib/date-utils.ts`** - Date manipulation utilities for finding available date ranges, checking date availability, calculating first 2 available nights, and handling date range selection logic.

- **`src/ui/BookingEngine.tsx`** - Main booking engine client component that orchestrates the collapsed/expanded states, manages date selection, and integrates with the calendar.

- **`src/ui/BookingCalendar.tsx`** - Calendar component built with Radix UI that displays dates, handles selection, and shows availability states. Uses date-fns for date manipulation.

- **`src/ui/BookingEngineCollapsed.tsx`** - Collapsed state showing selected check-in/check-out dates and "Book" button.

- **`src/ui/BookingEngineExpanded.tsx`** - Expanded state showing the full calendar, person selector, and booking controls.

- **`src/app/api/availability/route.ts`** - API route to fetch and parse iCal feeds server-side, returning available/blocked dates for a specific room.

- **`src/hooks/useBookingDates.ts`** - Custom React hook to manage booking date state, fetch availability, and handle date selection logic.

- **`specs/feature_49_adw_f43e3084_booking_engine_ical_integration/unit_testing_spec.md`** - Unit test specification for iCal parsing, date utilities, and API route logic.

- **`specs/feature_49_adw_f43e3084_booking_engine_ical_integration/component_testing_spec.md`** - Component test specification for BookingEngine, BookingCalendar, and related UI components.

- **`specs/feature_49_adw_f43e3084_booking_engine_ical_integration/e2e_testing_spec.md`** - E2E test specification for complete booking flow validation.

## Implementation Plan

### Phase 1: Foundation

1. **Install Required Dependencies**
   - Install `date-fns` for date manipulation (compatible with Next.js and TypeScript)
   - Install `ical.js` for parsing iCal feeds
   - Install Radix UI components: `@radix-ui/react-popover` for calendar dropdown

2. **Create Data Layer**
   - Build iCal parser utility to fetch and parse .ics files
   - Create date utility functions for availability checking and range selection
   - Add TypeScript types for iCal events, date ranges, and booking state
   - Implement server-side API route to fetch availability for a given room

3. **Design Calendar Date Logic**
   - Implement algorithm to determine booked dates from iCal events
   - Handle check-in/check-out date logic: check-out dates ARE available for new check-ins
   - Example: Booking 02.03-05.03 blocks 02, 03, 04 (nights stayed) but 05 is available
   - Create function to find first 2 consecutive available nights
   - Validate date range selections to prevent overlapping with booked periods

### Phase 2: Core Implementation

1. **Build Calendar Component**
   - Create `BookingCalendar` using Radix Popover as base
   - Display month view with date grid
   - Show available dates, booked dates, and selected range with distinct visual states
   - Adapt colors to current palette (background: #f0eeea, foreground: #000000)
   - Implement month navigation (previous/next month)
   - Handle date selection with proper range logic

2. **Create Booking Engine States**
   - Build `BookingEngineCollapsed` component showing selected dates and "Book" button
   - Build `BookingEngineExpanded` component with calendar, person input (1-2), and controls
   - Implement slide-down/slide-up animation using CSS transitions
   - Add close button to expanded state
   - Manage state transitions between collapsed and expanded

3. **Implement Date Selection Logic**
   - Create `useBookingDates` hook to manage selected check-in/check-out
   - Fetch availability data from API route on component mount
   - Default to first 2 available consecutive nights
   - Validate selections against blocked dates
   - Update UI to reflect selection state

### Phase 3: Integration

1. **Connect to Existing Pages**
   - Update `BookingInfoBlock` to use `BookingEngine` instead of `AirbnbButton` for rooms
   - Pass room-specific iCal URLs to the API route
   - Keep `AirbnbButton` or contact info for event space (not applicable for direct booking)
   - Ensure responsive behavior matches existing mobile/desktop layouts

2. **API Integration**
   - Wire up `/api/availability` route with iCal URLs for Room 1 and Room 2
   - Room 1 iCal feeds:
     - Airbnb: `https://www.airbnb.com/calendar/ical/1424633715489915166.ics?t=ff640aed3a604c3aadd5a66bf074eeeb`
     - Booking.com: `https://ical.booking.com/v1/export?t=f4d7c087-b9c7-40e9-9df6-e3a10697e0c1`
   - Room 2 iCal feeds:
     - Airbnb: `https://www.airbnb.com/calendar/ical/1507883205063503481.ics?t=a2a6a904567f41d88df17f0f6ec20b98`
     - Booking.com: `https://ical.booking.com/v1/export/t/9614a995-523b-48f9-8cb4-64f52eebaa42.ics`
     - VRBO: `http://www.vrbo.com/icalendar/f1c545555adb4c4984d582e1468e7c6b.ics`
   - Implement caching strategy to avoid fetching iCal feeds on every request (cache for 1 hour)
   - Handle fetch errors gracefully (show message if availability cannot be determined)

3. **Polish & Accessibility**
   - Ensure keyboard navigation works for calendar (tab, arrow keys, enter)
   - Add ARIA labels for date states (available, booked, selected)
   - Test with screen readers
   - Verify mobile touch interactions
   - Apply consistent styling with current design system

## Technical Considerations

### Performance

- **iCal Fetch Caching**: Implement server-side caching (1 hour TTL) to reduce external API calls
- **Lazy Loading**: Only fetch availability when user navigates to a room page
- **Optimistic UI**: Pre-select first 2 available nights immediately after availability data loads
- **Debounce**: Debounce month navigation to prevent excessive re-renders

### Security

- **Server-Side Fetching**: All iCal feeds fetched server-side via API route to prevent CORS issues and protect URLs
- **Input Validation**: Validate room type parameter to prevent unauthorized access
- **Rate Limiting**: Consider rate limiting the availability API route to prevent abuse
- **HTTPS Enforcement**: Ensure all iCal feed URLs use HTTPS (note: VRBO URL uses HTTP, may need proxy)

### Accessibility

- **Keyboard Navigation**: Full keyboard support for calendar (Tab, Arrow keys, Enter, Escape)
- **ARIA Labels**: Proper ARIA attributes for calendar grid, selected dates, and unavailable dates
- **Focus Management**: Manage focus when expanding/collapsing booking engine
- **Screen Reader Announcements**: Announce date selections and availability status changes
- **Color Contrast**: Ensure sufficient contrast for date states (available vs. booked vs. selected)

### Error Handling

- **iCal Fetch Failures**: Display user-friendly message if availability cannot be determined (e.g., "Availability temporarily unavailable. Please try again later.")
- **Invalid Date Selection**: Prevent selection of booked dates and show validation message
- **No Available Dates**: Handle scenario where no dates are available in the next 3 months
- **Network Errors**: Implement retry logic with exponential backoff for iCal fetches
- **Malformed iCal Data**: Gracefully handle parsing errors and log for debugging

## Prerequisites (BLOCKING)

Complete ALL prerequisites before running /implement. These require human action and cannot be automated.

### Infrastructure Tasks

None required for this feature. This feature uses client-side state and server-side API routes for fetching iCal data. No database tables or external infrastructure changes needed.

### Environment Tasks

Existing environment variables are sufficient for this feature. No new environment variables required.

---

NOTE: The /implement command will verify these prerequisites before starting code implementation. If any prerequisite fails verification, implementation will be BLOCKED until the human completes the required action.

## Step by Step Tasks

IMPORTANT: Prerequisites section above MUST be completed first. These steps assume all infrastructure and environment is ready.

IMPORTANT: Execute every step in order, top to bottom.

### 1. Install Dependencies

- Run `yarn add date-fns ical.js` to install date manipulation and iCal parsing libraries
- Run `yarn add -D @types/ical.js` to install TypeScript types for ical.js
- Run `yarn add @radix-ui/react-popover` to install Radix UI Popover component for calendar dropdown

### 2. Create Type Definitions

- Update `src/types/booking.ts` to add:
  - `ICalEvent` type for parsed calendar events (DTSTART, DTEND, SUMMARY)
  - `DateRange` type for check-in/check-out ranges
  - `AvailabilityData` type for API response (blocked dates, available ranges)
  - `BookingEngineState` type for component state (collapsed/expanded, selected dates, person count)

### 3. Build Date Utilities

- Create `src/lib/date-utils.ts` with functions:
  - `isDateBlocked(date: Date, blockedRanges: DateRange[]): boolean` - Check if a date falls within any blocked range
  - `getBlockedDates(events: ICalEvent[]): DateRange[]` - Convert iCal events to blocked date ranges
  - `findFirstAvailableNights(blockedRanges: DateRange[], nights: number): DateRange | null` - Find first N consecutive available nights
  - `isValidDateRange(checkIn: Date, checkOut: Date, blockedRanges: DateRange[]): boolean` - Validate selected range doesn't overlap with blocked dates
  - `mergeDateRanges(ranges: DateRange[]): DateRange[]` - Merge overlapping date ranges for optimization

### 4. Build iCal Parser

- Create `src/lib/ical-parser.ts` with functions:
  - `fetchICalFeed(url: string): Promise<string>` - Fetch iCal data from URL with timeout
  - `parseICalData(icalString: string): ICalEvent[]` - Parse iCal string into event objects using ical.js
  - `extractBlockedDates(events: ICalEvent[]): DateRange[]` - Extract check-in to check-out ranges, excluding check-out dates
  - `mergeMultipleFeeds(urls: string[]): Promise<DateRange[]>` - Fetch and merge blocked dates from multiple iCal feeds
  - Error handling for malformed iCal data and network failures

### 5. Create Availability API Route

- Create `src/app/api/availability/route.ts`:
  - Accept `GET` request with `room` query parameter (room1 or room2)
  - Map room to corresponding iCal feed URLs
  - Use `mergeMultipleFeeds()` to fetch and parse all feeds
  - Implement in-memory caching with 1-hour TTL (use simple Map with timestamp)
  - Return JSON response: `{ blockedDates: DateRange[], error?: string }`
  - Handle errors gracefully and return partial data if some feeds fail

### 6. Create Booking Dates Hook

- Create `src/hooks/useBookingDates.ts`:
  - Accept `roomType` parameter
  - Fetch availability from `/api/availability?room={roomType}` on mount
  - Manage state: `blockedDates`, `checkInDate`, `checkOutDate`, `isLoading`, `error`
  - Use `findFirstAvailableNights()` to default to first 2 available nights after data loads
  - Expose methods: `setCheckIn`, `setCheckOut`, `isDateAvailable`, `validateRange`
  - Use `useMemo` to optimize blocked date calculations

### 7. Build Calendar Component

- Create `src/ui/BookingCalendar.tsx`:
  - Build month calendar grid using Radix Popover as container
  - Accept props: `blockedDates`, `selectedCheckIn`, `selectedCheckOut`, `onDateSelect`
  - Render month header with navigation (prev/next month buttons)
  - Render date grid (7 columns for days of week)
  - Apply CSS classes based on date state:
    - Available: default styling
    - Blocked: greyed out, not clickable
    - Selected check-in: highlighted with start-of-range styling
    - Selected check-out: highlighted with end-of-range styling
    - In-range: highlighted with middle-of-range styling
  - Implement date selection logic (first click = check-in, second click = check-out, third click = reset)
  - Add keyboard navigation (arrow keys to move between dates, Enter to select)
  - Add ARIA labels for accessibility

### 8. Build Collapsed State Component

- Create `src/ui/BookingEngineCollapsed.tsx`:
  - Display selected check-in and check-out dates in a compact format
  - Show "Book" button
  - On "Book" button click, trigger `onExpand` callback to show expanded state
  - Style to match mockup: dates displayed inline with button

### 9. Build Expanded State Component

- Create `src/ui/BookingEngineExpanded.tsx`:
  - Display `BookingCalendar` component
  - Show person selector input (1-2, default 1) with validation
  - Show selected check-in/check-out dates at top
  - Include "Close" button to collapse back to collapsed state
  - Include "Book" button (disabled if dates not selected)
  - Implement slide-down animation using CSS transitions
  - Style to match mockup with calendar and controls

### 10. Create Main Booking Engine Component

- Create `src/ui/BookingEngine.tsx`:
  - Client component (`'use client'`)
  - Accept props: `roomType` (room1 | room2), `onBook` callback
  - Use `useBookingDates` hook to manage date selection and availability
  - Manage `isExpanded` state for toggling between collapsed and expanded views
  - Conditionally render `BookingEngineCollapsed` or `BookingEngineExpanded`
  - Pass date selection handlers to calendar
  - Handle "Book" button click: validate dates, call `onBook` with selected dates and person count
  - Show loading state while fetching availability
  - Show error state if availability fetch fails

### 11. Update Booking Info Block

- Modify `src/app/(main)/booking/ui/BookingInfoBlock.tsx`:
  - Import `BookingEngine` component
  - Replace `AirbnbButton` rendering with conditional logic:
    - If `type === "room"` and `roomType` is provided, render `BookingEngine`
    - Otherwise, render `AirbnbButton` (for event space)
  - Add `roomType` prop to component (room1 | room2 | undefined)
  - Pass `onBook` handler that opens Airbnb URL or initiates booking flow

### 12. Update Booking Content

- Modify `src/app/(main)/booking/ui/BookingContent.tsx`:
  - Pass `roomType="room1"` to `BookingInfoBlock` for Room 1
  - Pass `roomType="room2"` to `BookingInfoBlock` for Room 2
  - Ensure event space continues to use contact info or Airbnb button

### 13. Add Calendar Styling

- Update `src/app/globals.css`:
  - Add CSS classes for calendar date states:
    - `.calendar-date-available`: default state
    - `.calendar-date-blocked`: greyed out, cursor not-allowed
    - `.calendar-date-selected`: highlighted background
    - `.calendar-date-range-start`: rounded left corners
    - `.calendar-date-range-middle`: no rounded corners
    - `.calendar-date-range-end`: rounded right corners
  - Use current color palette: background #f0eeea, foreground #000000
  - Ensure sufficient contrast for accessibility
  - Add transition effects for hover states

### 14. Create Unit Testing Spec

- Create `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/unit_testing_spec.md` following the format in `app_docs/testing/unit_test_spec_format.md`:
  - Define test scope: `ical-parser.ts`, `date-utils.ts`, `/api/availability/route.ts`
  - List test files to create:
    - `src/lib/ical-parser.unit.test.ts`
    - `src/lib/date-utils.unit.test.ts`
    - `src/app/api/availability/route.unit.test.ts`
  - Specify test cases for each function (happy path, edge cases, error handling)
  - Include validation command: `yarn test:unit`

### 15. Create Component Testing Spec

- Create `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/component_testing_spec.md` following the format in `app_docs/testing/component_test_spec_format.md`:
  - Define test scope: `BookingEngine`, `BookingCalendar`, `BookingEngineCollapsed`, `BookingEngineExpanded`
  - List test files to create:
    - `src/ui/BookingEngine.browser.test.tsx`
    - `src/ui/BookingCalendar.browser.test.tsx`
  - Specify user interactions: date selection, expand/collapse, person input
  - Specify accessibility requirements: keyboard navigation, ARIA labels
  - Define mocking strategy: mock availability API, mock date utilities
  - Include validation command: `yarn test:browser`

### 16. Create E2E Testing Spec

- Create `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/e2e_testing_spec.md` following the format in `app_docs/testing/e2e_example.md`:
  - Define user story: "As a potential guest, I want to book a room by selecting dates in the booking engine"
  - List test steps:
    1. Navigate to `/booking/room1`
    2. Verify booking engine is in collapsed state with first 2 available nights selected
    3. Click on check-in date to expand booking engine
    4. Verify calendar is visible with available/blocked dates
    5. Select different check-in date
    6. Select check-out date
    7. Verify selected range is highlighted
    8. Change person count to 2
    9. Click "Book" button
    10. Verify booking is initiated or Airbnb redirect occurs
  - Specify success criteria: date selection works, blocked dates are not selectable, UI states match mockups
  - Include 5 screenshots at key steps

### 17. Implement Caching Strategy

- Add in-memory cache to `/api/availability/route.ts`:
  - Use `Map<string, { data: AvailabilityData, timestamp: number }>`
  - Cache key: room type
  - Cache TTL: 1 hour (3600000 ms)
  - Check cache before fetching iCal feeds
  - Return cached data if not expired
  - Implement cache invalidation logic

### 18. Handle Edge Cases

- Implement logic for edge cases:
  - No available dates in next 3 months: Show message "No availability in the next 3 months"
  - iCal fetch failure: Show message "Availability temporarily unavailable. Please try again."
  - Invalid date range selection: Prevent selection and show validation message
  - Selected dates become unavailable: Clear selection and show notification
  - Overlapping bookings from multiple platforms: Correctly merge and block all overlapping ranges

### 19. Accessibility Audit

- Test keyboard navigation:
  - Tab through booking engine components
  - Use arrow keys to navigate calendar dates
  - Press Enter to select dates
  - Press Escape to close expanded view
- Verify ARIA labels for all interactive elements
- Test with screen reader (VoiceOver on macOS or NVDA on Windows)
- Ensure color contrast meets WCAG AA standards (at least 4.5:1 for text)

### 20. Run Validation Commands

- Execute all validation commands to ensure zero regressions and complete functionality
- Read and execute E2E test from `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/e2e_testing_spec.md`
- Run `yarn build` to validate production build

## Testing Strategy

### Edge Cases

1. **No Available Dates**: Room is fully booked for next 3 months
2. **Single Night Gap**: A single available night between two bookings (not selectable for 2-night minimum)
3. **Check-out Date Availability**: Verify that check-out dates ARE available for new bookings (e.g., booking ends 05.03, new booking can start 05.03)
4. **Overlapping Bookings**: Same dates blocked on multiple platforms (Airbnb + Booking.com)
5. **iCal Feed Failure**: One or more iCal feeds fail to fetch
6. **Malformed iCal Data**: iCal feed contains invalid date formats
7. **Past Dates**: Prevent selection of dates in the past
8. **Long Booking Range**: User tries to select a 30+ night stay
9. **Month Boundary**: Selected range crosses month boundary in calendar view
10. **Person Count Validation**: User enters invalid person count (0, 3, negative, non-integer)
11. **Rapid Clicking**: User rapidly clicks dates before state updates
12. **Mobile Touch**: Touch interactions on mobile devices
13. **Timezone Issues**: iCal dates in different timezones than user
14. **Same-Day Booking**: User tries to book for today or tomorrow

## Acceptance Criteria

1. **Visual Match**: Collapsed and expanded states visually match the provided mockups (adapted to current color palette)
2. **iCal Integration**: Blocked dates from all iCal feeds (Airbnb, Booking.com, VRBO) are correctly displayed as unavailable
3. **Date Logic**: Check-out dates ARE available for new bookings (e.g., if room booked 02.03-05.03, then 05.03 is available)
4. **Default Selection**: First 2 consecutive available nights are pre-selected when page loads
5. **Date Selection**: Users can select check-in and check-out dates via calendar
6. **Blocked Dates**: Users cannot select dates that fall within blocked ranges
7. **Person Input**: Person count can be set to 1 or 2 (default 1), with validation
8. **Expand/Collapse**: Clicking check-in/check-out dates expands the calendar; close button collapses it
9. **Button Visibility**: "Book" button outside engine only visible when collapsed; in expanded view, only the internal "Book" button is visible
10. **Book Action**: Clicking "Book" button initiates booking flow (opens Airbnb URL or custom booking flow)
11. **Responsive**: Works correctly on mobile and desktop
12. **Accessibility**: Full keyboard navigation, ARIA labels, screen reader support
13. **Error Handling**: Graceful error messages if availability cannot be determined
14. **Performance**: iCal data is cached for 1 hour to reduce load times
15. **Zero Regressions**: All existing functionality (event space, navigation, gallery) continues to work

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- **E2E Test**: Read `app_docs/testing/e2e_runner.md`, then read and execute the E2E test from `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/e2e_testing_spec.md` to validate the complete booking flow with real iCal data integration

- **Production Build**: Run `yarn build` to ensure the feature compiles without errors and is production-ready

## Notes

### Radix UI Components

- `@radix-ui/react-popover` - Used for calendar dropdown container
- Styled with Tailwind CSS utilities to match current design system

### iCal Date Logic Clarification

The booking date logic follows this rule:

- **Booked Range**: 02.03-05.03 means the guest checks in on 02.03 and checks out on 05.03
- **Nights Stayed**: 02.03 (night 1), 03.03 (night 2), 04.03 (night 3) = 3 nights
- **Blocked Dates**: 02.03, 03.03, 04.03 are blocked (nights where room is occupied)
- **Available Dates**: 05.03 is AVAILABLE because it's a check-out date (room is free that night)

This logic must be implemented in `getBlockedDates()` to exclude check-out dates from blocked ranges.

### Future Considerations

- **Direct Booking Flow**: Currently, "Book" button will redirect to Airbnb. Future iteration could implement direct booking with payment processing.
- **Calendar Sync**: Consider two-way sync to update iCal feeds when bookings are made through the website.
- **Multi-Room Booking**: Extend to allow booking both rooms simultaneously.
- **Flexible Nights**: Allow users to select stays longer than 2 nights (currently defaults to 2).
- **Price Display**: Show pricing information based on selected dates and room type.
- **Availability Notifications**: Allow users to subscribe to notifications when dates become available.

### Dependencies Installed

- `date-fns` - Modern date utility library (2.x)
- `ical.js` - iCal parsing library (2.x)
- `@types/ical.js` - TypeScript types for ical.js
- `@radix-ui/react-popover` - Accessible popover component for calendar dropdown

### Testing Specifications

Unit tests, component tests, and E2E tests are defined in separate specification files in the `specs/feature_49_adw_f43e3084_booking_engine_ical_integration/` directory. These specs document:

- New tests to create for new functionality
- Existing tests that may break and how to fix them
- Validation commands to verify all tests pass

Note: Unit and component tests are NOT included in validation commands as they may fail during implementation and require fixing. The test specifications will track both new tests to create AND existing tests that broke/failed and need fixing.
