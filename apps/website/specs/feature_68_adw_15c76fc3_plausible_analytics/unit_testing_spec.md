# Unit Testing Spec: Plausible Analytics Integration

## Test Scope

### In Scope

Test the analytics utility library (`src/lib/analytics.ts`) to ensure all event tracking functions work correctly with proper type safety and error handling.

## New Unit Tests

### Test Files to Create

- `src/lib/analytics.unit.test.ts` - Unit tests for analytics utility functions

### Coverage Areas

- Event tracking functions (all event types)
- Environment variable handling
- Browser-only initialization guard
- Error handling for failed tracking calls

### Test Cases

#### Analytics Utility (`src/lib/analytics.ts`)

**Purpose**: Centralized type-safe analytics tracking with Plausible

**Test Cases**:

- **Environment Configuration**:
  - Should not initialize Plausible when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is not set
  - Should log a warning when domain is missing
  - Should initialize Plausible with correct domain when environment variable is set

- **Browser-Only Execution**:
  - Should not execute tracking on server-side (when window is undefined)
  - Should only initialize Plausible in browser environment

- **Weekly Offer Events**:
  - trackWeeklyOfferViewed should call Plausible with correct event name
  - trackRoomTabClicked should include room property
  - trackGalleryThumbnailClicked should include imageIndex and context (room/type)
  - trackWhatsAppClicked should include page property
  - trackAirbnbClicked should include room property
  - trackScrolled50 should include page property

- **Booking Events**:
  - trackBookingViewed should call Plausible with correct event name
  - trackCalendarOpened should call Plausible with correct event name
  - trackDateSelected should include startDate and endDate properties
  - trackBookButtonClicked should call Plausible with correct event name

- **Contact Events**:
  - trackContactViewed should call Plausible with correct event name
  - trackInstagramClicked should include page property

- **Error Handling**:
  - Should catch and log errors when Plausible tracking fails
  - Should not throw errors that could break application flow
  - Should warn in development but not break production

## Failed/Broken Tests (if applicable)

**To discover failed/broken unit tests, run**: `yarn test:unit` or `npx vitest --project=unit`

No existing unit tests are expected to fail from this implementation since this is a new feature.

### Validation Command

`yarn test:unit` or `npx vitest --project=unit`

**Note**: All unit tests must pass before the feature is considered complete.
