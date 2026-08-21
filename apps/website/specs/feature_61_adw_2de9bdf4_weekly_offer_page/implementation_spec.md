# Feature: Weekly Offer Page

## Metadata

issue_number: `61`
adw_id: `2de9bdf4`
issue_json: `{"number":61,"title":"Weekly offer page","body":"Create a custom week offer page. It should not be available in the main navigation. I will only share it with link. Add meta information to this page so when I share preview is available. It should show room 1 and room 2 as on the booking page. Weekly price per room is 300 euros per 1 person, 400 euros per 2 people. Follow the style and arrangement as per booking page. I should be able to see room 1 and room 2 as tabs as on the booking page. Place callout that would say that to reserve message me on WhatsApp. Also add the location which is Almocagem and add nearby attractions like Adraga beach, walking distance, many hikes available by foot from the village. And also saying that it has all necessary essentials like supermarket, like grocery store, vegetable stores, pharmacy, restaurants, cafes. For review they can check the airbnb page, so add airbnb button that will show room reviews. Also add information about availability: room 08.03 - 05.04 (available for booking), room 2 - 16.03 - 09.04. follow the structure as per booking page, there will be no calendar. "}`

## Feature Description

Create a standalone weekly offer page that showcases special weekly pricing for Room 1 and Room 2. This page will be accessible only via direct link (not in main navigation) and will feature custom metadata for social media previews. The page will follow the existing booking page structure with tabs for Room 1 and Room 2, display weekly pricing (300€/week for 1 person, 400€/week for 2 people), include location information about Almoçageme, nearby attractions, and specific availability dates for each room. No calendar or booking engine will be included - instead, a WhatsApp call-to-action will direct users to message for reservations.

## User Story

As a guest interested in a weekly stay
I want to view special weekly offer pricing for both rooms with location details and availability
So that I can quickly understand the offer and contact the host on WhatsApp to book

## Problem Statement

The current booking system is designed for nightly bookings with a calendar interface. There's no way to showcase special weekly offers with simplified pricing and specific availability dates. The host needs a shareable page that presents weekly deals without the complexity of the booking engine, while maintaining the visual style and room presentation of the existing booking page.

## Solution Statement

Create a new standalone page at `/weekly-offer` that mirrors the booking page layout (tabs, gallery, room information) but replaces the booking engine with:

- Simple weekly pricing display (300€ for 1 person, 400€ for 2 people)
- Specific availability date ranges for each room
- Location information about Almoçageme with nearby attractions and amenities
- WhatsApp call-to-action for reservations
- Airbnb button linking to reviews
- Custom Open Graph meta tags for rich social media previews

The page will reuse existing components (Gallery, tabs structure, Callout, WhatsAppLink) and follow the same responsive design patterns as the booking page.

## Relevant Files

Use these files to implement the feature:

- `src/app/(main)/booking/[type]/page.tsx` - Reference for page structure, layout pattern with tabs and gallery
- `src/app/(main)/booking/[type]/ui/BookingContent.tsx` - Reference for content structure and room information display
- `src/app/(main)/booking/[type]/ui/BookingTabsDesktop.tsx` - Reference for desktop tab navigation pattern
- `src/app/(main)/booking/[type]/ui/BookingTabsMobile.tsx` - Reference for mobile tab navigation pattern
- `src/app/(main)/booking/[type]/ui/Gallery.tsx` - Gallery component to reuse for room images
- `src/app/(main)/booking/[type]/ui/BookingInfoBlock.tsx` - Reference for room information block structure
- `src/app/(main)/booking/layout.tsx` - Reference for booking page layout with Providers
- `src/app/layout.tsx` - Root layout with default metadata tags
- `src/app/ui/Callout.tsx` - Callout component to use for WhatsApp reservation message
- `src/app/ui/WhatsAppLink.tsx` - WhatsApp link component to reuse
- `src/utils/images.ts` - Image arrays for Room 1 and Room 2 galleries
- `src/types/booking.ts` - BookingType enum (may need to reference for consistency)
- `vitest.config.ts` - Test configuration for unit and component tests
- `app_docs/testing/e2e_example.md` - E2E test format example
- `app_docs/testing/e2e_runner.md` - E2E test execution guide

### New Files

- `src/app/(main)/weekly-offer/page.tsx` - Main weekly offer page with custom metadata
- `src/app/(main)/weekly-offer/ui/WeeklyOfferContent.tsx` - Server component for weekly offer room content
- `src/app/(main)/weekly-offer/ui/WeeklyOfferTabs.tsx` - Client component for room tabs (Room 1/Room 2 only)
- `src/app/(main)/weekly-offer/ui/WeeklyOfferInfoBlock.tsx` - Component for weekly pricing and availability display
- `specs/feature_61_adw_2de9bdf4_weekly_offer_page/e2e_testing_spec.md` - E2E test specification

## Implementation Plan

### Phase 1: Foundation

Create the basic page structure and routing:

- Set up the `/weekly-offer` route as a standalone page (not part of booking dynamic route)
- Create the page layout following the booking page two-column pattern (gallery on right, content on left)
- Add custom metadata for Open Graph and Twitter cards with weekly offer specific title and description

### Phase 2: Core Implementation

Build the weekly offer specific components:

- Create tab navigation component for switching between Room 1 and Room 2 (client component with state)
- Develop the weekly offer info block component that displays:
  - Room title and subtitle
  - Weekly pricing (300€/1 person, 400€/2 people)
  - Specific availability dates
  - Room capacity
  - Location section (Almoçageme)
  - Nearby attractions (Adraga beach, hiking trails)
  - Amenities (supermarket, grocery, pharmacy, restaurants, cafes)
  - Airbnb review button
  - WhatsApp reservation callout
- Reuse the existing Gallery component for displaying room images

### Phase 3: Integration

Connect all components and ensure proper functionality:

- Integrate gallery with room-specific image sets
- Wire up tab switching to update displayed room content and gallery
- Add responsive design for mobile and desktop views
- Ensure accessibility (keyboard navigation, ARIA labels)
- Verify metadata renders correctly for link previews

## Technical Considerations

### Performance

- Use Next.js Image component for all images (already implemented in Gallery)
- Server components by default, client components only for tab interaction
- No external API calls or database queries needed
- Static page generation possible since content is hardcoded

### Security

- No user input or forms, so no validation needed
- WhatsApp link uses existing secure component
- Airbnb links open in new tab with `rel="noopener noreferrer"`

### Accessibility

- Proper semantic HTML structure (headings, lists, sections)
- ARIA labels on tab buttons
- Keyboard navigation support for tabs
- Screen reader friendly content structure
- Sufficient color contrast (inherits from existing design)

### Error Handling

- No error handling needed as there are no dynamic data sources
- Invalid routes handled by Next.js 404

## Prerequisites (BLOCKING)

Complete ALL prerequisites before running /implement. These require human action and cannot be automated.

### Infrastructure Tasks

None required for this feature.

### Environment Tasks

Existing environment variables are sufficient for this feature.

---

NOTE: The /implement command will verify these prerequisites before starting code implementation. If any prerequisite fails verification, implementation will be BLOCKED until the human completes the required action.

## Step by Step Tasks

IMPORTANT: Prerequisites section above MUST be completed first. These steps assume all infrastructure and environment is ready.

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create E2E Testing Specification

- Read `app_docs/testing/e2e_example.md` to understand the E2E test format
- Read `app_docs/testing/e2e_runner.md` to understand how E2E tests are executed
- Create `specs/feature_61_adw_2de9bdf4_weekly_offer_page/e2e_testing_spec.md` following the format from the example
- Include test scenarios for:
  - Navigating directly to `/weekly-offer` URL
  - Verifying page loads with Room 1 displayed by default
  - Clicking Room 2 tab and verifying content switches
  - Verifying weekly pricing is displayed correctly (300€/1 person, 400€/2 people)
  - Verifying availability dates are shown
  - Verifying location and attractions information
  - Verifying WhatsApp callout is present
  - Verifying Airbnb button links correctly
  - Taking screenshots of both Room 1 and Room 2 views
  - Verifying metadata tags for social preview

### 2. Create Weekly Offer Tab Component

- Create `src/app/(main)/weekly-offer/ui/WeeklyOfferTabs.tsx` as a client component
- Implement state management for active room tab (Room 1 or Room 2)
- Create tab buttons using similar styling to BookingTabsDesktop
- Only show Room 1 and Room 2 tabs (no event space)
- Add proper ARIA labels and keyboard navigation
- Export callback to parent for room selection changes

### 3. Create Weekly Offer Info Block Component

- Create `src/app/(main)/weekly-offer/ui/WeeklyOfferInfoBlock.tsx`
- Accept props: room (room1 | room2), title, subtitle, capacity
- Display weekly pricing section with clear formatting:
  - "Weekly Price: 300€ (1 person) | 400€ (2 people)"
- Display availability section with date ranges:
  - Room 1: "08.03 - 05.04 (available for booking)"
  - Room 2: "16.03 - 09.04 (available for booking)"
- Add location section with heading "Location: Almoçageme"
- Add nearby attractions list:
  - Adraga beach (walking distance)
  - Many hiking trails available by foot from the village
- Add amenities section listing: supermarket, grocery store, vegetable stores, pharmacy, restaurants, cafes
- Add Airbnb button with appropriate link based on room
  - Use existing Airbnb URLs from BookingContent.tsx
  - Button text: "Read reviews on Airbnb"
  - Open in new tab with proper rel attributes
- Include WhatsApp reservation callout using Callout and WhatsAppLink components
  - Message: "To reserve your weekly stay, please message us on WhatsApp"

### 4. Create Weekly Offer Content Component

- Create `src/app/(main)/weekly-offer/ui/WeeklyOfferContent.tsx` as a server component
- Accept room type as prop (room1 | room2)
- Render WeeklyOfferInfoBlock with room-specific data
- Include room descriptions similar to booking page but adapted for weekly stays
- Follow the same spacing and typography patterns as BookingContent

### 5. Create Main Weekly Offer Page

- Create `src/app/(main)/weekly-offer/page.tsx`
- Add custom metadata export with:
  - Title: "Weekly Stay Offer - Issebya Homes"
  - Description: "Special weekly rates in Almoçageme - 300€/week (1 person) or 400€/week (2 people). Room 1 available 08.03-05.04, Room 2 available 16.03-09.04."
  - OpenGraph image: Use existing living room image
  - OpenGraph URL: https://issebya.com/weekly-offer
- Implement client-side state for active room (useState, default to room1)
- Render two-column layout matching booking page:
  - Left column: WeeklyOfferTabs and WeeklyOfferContent
  - Right column: Gallery with room-specific images
- Use same layout pattern as booking/[type]/page.tsx (flex, responsive, sticky gallery)
- Import room1Images and room2Images from utils/images.ts
- Switch gallery images when room tab changes

### 6. Validation

Execute validation commands to ensure the feature works correctly:

- Read and execute the E2E test from `specs/feature_61_adw_2de9bdf4_weekly_offer_page/e2e_testing_spec.md` following `app_docs/testing/e2e_runner.md`
- Run `yarn build` to validate the page builds without errors
- Verify metadata renders correctly by inspecting page source

## Testing Strategy

### Edge Cases

- Direct navigation to `/weekly-offer` URL
- Tab switching between Room 1 and Room 2 multiple times
- Mobile vs desktop responsive layouts
- Gallery thumbnail navigation with weekly offer content
- Social media link preview rendering (metadata)
- Airbnb link opening in new tab
- WhatsApp link functionality

## Cleanup Checklist

Before final validation, verify:

- [ ] Unused functions/variables removed (not commented out)
- [ ] Dead imports removed
- [ ] Components no longer used have been deleted
- [ ] Old hooks replaced by new patterns have been deleted
- [ ] No TODO comments left from implementation

## Acceptance Criteria

- [ ] Page is accessible at `/weekly-offer` route
- [ ] Page does not appear in main navigation
- [ ] Custom metadata (title, description, OG image) renders correctly for link previews
- [ ] Room 1 and Room 2 tabs are displayed and functional
- [ ] Clicking tabs switches between Room 1 and Room 2 content
- [ ] Gallery updates to show correct room images when tabs switch
- [ ] Weekly pricing is clearly displayed (300€ for 1 person, 400€ for 2 people)
- [ ] Availability dates are shown for each room (Room 1: 08.03-05.04, Room 2: 16.03-09.04)
- [ ] Location "Almoçageme" is displayed
- [ ] Nearby attractions include Adraga beach and hiking trails
- [ ] Amenities section lists supermarket, grocery, pharmacy, restaurants, cafes
- [ ] Airbnb button links to appropriate room reviews and opens in new tab
- [ ] WhatsApp callout is present with link to contact
- [ ] Page follows same visual style as booking page
- [ ] Page is fully responsive on mobile and desktop
- [ ] Keyboard navigation works for tabs
- [ ] E2E test passes successfully
- [ ] Build completes without errors

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- E2E Tests: Read `app_docs/testing/e2e_runner.md`, then read and execute your new E2E test from `specs/feature_61_adw_2de9bdf4_weekly_offer_page/e2e_testing_spec.md` to validate end-to-end functionality
- `yarn build` - Run frontend build to validate the feature works with zero regressions

## Notes

### Design Consistency

This page intentionally mirrors the booking page structure to maintain visual consistency while serving a different purpose (weekly offers vs nightly booking). Key differences:

- No booking engine or calendar
- Simplified pricing (weekly flat rates instead of nightly calculations)
- Static availability dates instead of dynamic calendar
- WhatsApp CTA instead of booking flow

### Future Considerations

- If weekly offers become a regular feature, consider making dates configurable via CMS or environment variables
- Consider adding multiple weekly offer periods if demand increases
- Could extend to event space weekly rentals if needed

### Content Reuse

Maximum reuse of existing components:

- `Gallery` - unchanged
- `Callout` - unchanged
- `WhatsAppLink` - unchanged
- `room1Images`, `room2Images` - unchanged
- Layout patterns - adapted from booking page

### Radix UI Components

This feature does not require Radix UI components as it uses simple button elements for tabs and doesn't need complex interactive UI primitives. All interactions are straightforward click handlers on basic HTML elements styled with Tailwind CSS.
