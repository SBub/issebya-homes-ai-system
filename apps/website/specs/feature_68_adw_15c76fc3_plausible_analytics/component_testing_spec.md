# Component Testing Spec: Plausible Analytics Integration

## Test Scope

### In Scope

Test synchronous client components that implement analytics tracking:

- ScrollTracker component
- Tracked link wrapper components (WhatsApp, Airbnb, Instagram)
- Client wrappers for tab navigation

## New Component Tests

### Test Files to Create

- `src/ui/ScrollTracker.browser.test.tsx` - Test scroll depth tracking component
- `src/app/(main)/weekly-offer/[room]/ui/TrackedWhatsAppLink.browser.test.tsx` - Test WhatsApp link tracking
- `src/app/(main)/weekly-offer/[room]/ui/TrackedAirbnbLink.browser.test.tsx` - Test Airbnb link tracking
- `src/app/(main)/weekly-offer/[room]/ui/WeeklyOfferTabsClient.browser.test.tsx` - Test room tab click tracking

**Note**: Only synchronous client components. The main pages are Server Components and should use E2E tests.

### Coverage Areas

- Scroll tracking functionality
- Click tracking on links
- Tab navigation tracking
- Event properties passed correctly

### Test Cases

#### ScrollTracker Component

**Purpose**: Track when user scrolls 50% down the page

**User Interactions to Test**:

- Should not track before 50% scroll threshold is reached
- Should track event when user scrolls to 50% of page
- Should only track event once per page session
- Should not track multiple times on repeated scrolling

**Accessibility to Test**:

- Should not interfere with scroll behavior
- Should not affect keyboard navigation

**Edge Cases**:

- Should handle very short pages (less scrollable area)
- Should handle rapid scroll changes
- Should cleanup event listeners on unmount

#### TrackedWhatsAppLink Component

**Purpose**: Track WhatsApp link clicks with page context

**User Interactions to Test**:

- Should render WhatsApp link with correct href
- Should track click event with correct page property
- Should not prevent default link behavior
- Should open link in new tab (target="\_blank")

**Accessibility to Test**:

- Should have proper rel="noopener noreferrer" for security
- Should be keyboard accessible
- Should have appropriate aria labels

**Edge Cases**:

- Should handle rapid consecutive clicks
- Should track even if analytics fails

#### TrackedAirbnbLink Component

**Purpose**: Track Airbnb link clicks with room context

**User Interactions to Test**:

- Should render Airbnb link with correct href
- Should track click event with room property
- Should not prevent default link behavior
- Should open link in new tab

**Accessibility to Test**:

- Should have proper rel="noopener noreferrer" for security
- Should be keyboard accessible

**Edge Cases**:

- Should handle different room values (room1, room2)
- Should track even if analytics fails

#### WeeklyOfferTabsClient Component

**Purpose**: Track room tab navigation clicks

**User Interactions to Test**:

- Should render tabs for room1 and room2
- Should track click event when tab is clicked
- Should include room property in tracking
- Should maintain navigation functionality

**Accessibility to Test**:

- Should be keyboard navigable
- Should have proper ARIA roles for tabs

**Edge Cases**:

- Should handle rapid tab switching
- Should track each tab click separately

### Mocking Strategy

Mock the analytics utility module:

- Use `vi.mock('@/lib/analytics')` to mock all tracking functions
- Create mock implementations with `vi.fn()` for each tracking function
- Verify tracking functions are called with correct parameters
- Ensure mocks don't interfere with component rendering

Example:

```typescript
vi.mock("@/lib/analytics", () => ({
  trackScrolled50: vi.fn(),
  trackWhatsAppClicked: vi.fn(),
  trackAirbnbClicked: vi.fn(),
  trackRoomTabClicked: vi.fn(),
}));
```

## Failed/Broken Tests (if applicable)

**To discover failed/broken component tests, run**: `yarn test:browser` or `npx vitest --project=browser --browser.headless`

No existing component tests are expected to fail from this implementation since this feature adds new components.

### Validation Command

`yarn test:browser` or `npx vitest --project=browser --browser.headless`

**Note**: All component tests must pass before the feature is considered complete.
