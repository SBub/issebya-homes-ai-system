# Unit Testing Spec: Booking Engine with iCal Integration

## Test Scope

### In Scope

- iCal parsing and feed fetching functions (`src/lib/ical-parser.ts`)
- Date manipulation and validation utilities (`src/lib/date-utils.ts`)
- Availability API route logic (`src/app/api/availability/route.ts`)

## New Unit Tests

### Test Files to Create

- `src/lib/ical-parser.unit.test.ts` - Tests for iCal feed fetching and parsing
- `src/lib/date-utils.unit.test.ts` - Tests for date manipulation and validation
- `src/app/api/availability/route.unit.test.ts` - Tests for availability API endpoint

### Coverage Areas

1. **iCal Parser** (`ical-parser.ts`):
   - Fetching iCal feeds from URLs with timeout handling
   - Parsing valid iCal data into event objects
   - Handling malformed iCal data
   - Merging multiple feeds and handling partial failures
   - Extracting blocked date ranges from events

2. **Date Utilities** (`date-utils.ts`):
   - Checking if dates are blocked (respecting check-out date logic)
   - Converting iCal events to blocked date ranges
   - Merging overlapping date ranges
   - Finding first available consecutive nights
   - Validating date range selections
   - Handling past dates

3. **Availability API Route** (`route.ts`):
   - Validating room parameter
   - Returning blocked dates for valid rooms
   - Caching mechanism and TTL
   - Handling fetch errors gracefully
   - Returning partial data when some feeds fail

### Test Cases

#### `fetchICalFeed(url: string, timeoutMs?: number)`

**Purpose**: Fetch iCal feed data from a URL with timeout protection

**Test Cases**:

- Should successfully fetch iCal data from valid URL
- Should throw error when URL returns non-200 status
- Should abort request after timeout expires
- Should include User-Agent header in request
- Should handle network errors gracefully

#### `parseICalData(icalString: string)`

**Purpose**: Parse iCal string into structured event objects

**Test Cases**:

- Should parse valid iCal data with single event
- Should parse valid iCal data with multiple events
- Should extract DTSTART, DTEND, and SUMMARY from events
- Should throw error for malformed iCal data
- Should handle empty iCal calendar (no events)
- Should handle events without summary field

#### `extractBlockedDates(events: ICalEvent[])`

**Purpose**: Convert iCal events to blocked date ranges

**Test Cases**:

- Should convert single event to date range
- Should convert multiple events to multiple date ranges
- Should handle events with same-day start and end
- Should handle empty events array

#### `mergeMultipleFeeds(urls: string[])`

**Purpose**: Fetch and merge blocked dates from multiple iCal feeds

**Test Cases**:

- Should merge blocked dates from multiple successful feeds
- Should return partial data when some feeds fail
- Should collect error messages for failed feeds
- Should handle all feeds failing
- Should handle empty URLs array
- Should fetch all feeds in parallel

#### `isDateBlocked(date: Date, blockedRanges: DateRange[])`

**Purpose**: Check if a date falls within any blocked range (excluding check-out dates)

**Test Cases**:

- Should return true for date within blocked range
- Should return false for date outside all blocked ranges
- Should return false for check-out date (end of range)
- Should return true for check-in date (start of range)
- Should handle empty blocked ranges array
- Should normalize dates to start of day before comparing

#### `getBlockedDates(events: ICalEvent[])`

**Purpose**: Convert iCal events to blocked date ranges

**Test Cases**:

- Should convert events to date ranges with normalized dates
- Should handle multiple events
- Should handle empty events array

#### `mergeDateRanges(ranges: DateRange[])`

**Purpose**: Merge overlapping or adjacent date ranges

**Test Cases**:

- Should merge overlapping date ranges
- Should merge adjacent date ranges
- Should not merge non-overlapping ranges with gap
- Should handle single range
- Should handle empty array
- Should sort ranges by start date before merging
- Should return earliest start and latest end for overlapping ranges

#### `findFirstAvailableNights(blockedRanges: DateRange[], nights: number)`

**Purpose**: Find first N consecutive available nights starting from today

**Test Cases**:

- Should find first 2 available nights when dates available
- Should skip blocked ranges and find next available period
- Should return null when no dates available in 90 days
- Should handle edge case where available range is exactly at end of search window
- Should handle empty blocked ranges (all dates available)
- Should not select nights in the past

#### `isValidDateRange(checkIn: Date, checkOut: Date, blockedRanges: DateRange[])`

**Purpose**: Validate that selected date range doesn't overlap with blocked dates

**Test Cases**:

- Should return true for valid unblocked range
- Should return false if check-out is before or same as check-in
- Should return false if check-in is in the past
- Should return false if any night in range is blocked
- Should handle edge case where check-in is today
- Should return true for range with no blocked dates

#### `isPastDate(date: Date)`

**Purpose**: Check if a date is in the past

**Test Cases**:

- Should return true for date before today
- Should return false for today
- Should return false for future date
- Should normalize to start of day before comparing

#### Availability API Route (`GET /api/availability`)

**Purpose**: Return blocked dates for a given room

**Test Cases**:

- Should return blocked dates for valid room (room1)
- Should return blocked dates for valid room (room2)
- Should return 400 error for invalid room parameter
- Should return 400 error for missing room parameter
- Should return cached data within TTL
- Should fetch fresh data after cache expires
- Should return partial data with error message when some feeds fail
- Should return 500 error when all feeds fail
- Should include correct iCal URLs for each room

## Failed/Broken Tests (if applicable)

**To discover failed/broken unit tests, run**: `yarn test:unit` or `npx vitest --project=unit`

No existing unit tests should be broken by this feature, as it adds new functionality without modifying existing business logic.

If any tests fail during implementation, document them here with:

- Test file path
- Test name
- Why it failed
- How to fix it

### Validation Command

`yarn test:unit` or `npx vitest --project=unit`

**Note**: All unit tests (new and fixed) must pass before the feature is considered complete.
