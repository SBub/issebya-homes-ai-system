# Feature: Plausible Analytics Integration

## Metadata

issue_number: `68`
adw_id: `15c76fc3`
issue_json: `{"number":68,"title":"Plausible analytics","body":"Implement Plausible Analytics using the @plausible-analytics/tracker NPM package and configure it to automatically track pageviews and referrers across the site while defining custom events for (1) Weekly Offer page: WeeklyOffer Viewed, Room Tab Clicked (room1, room2), Gallery Thumbnail Clicked, WhatsApp Clicked, Airbnb Clicked, Instagram Clicked, Scrolled 50%, (2) Booking page: Booking Viewed, Calendar Opened, Date Selected, Book Button Clicked, WhatsApp Clicked from Booking, and (3) Contact page: Contact Viewed, WhatsApp Clicked from Contact, Instagram Clicked from Contact, so that traffic sources, engagement depth, and conversion intent can be analyzed, with event firing implemented via JavaScript calls such as plausible('WhatsApp Clicked', { props: { page: 'Weekly Offer' } }), and with the tracker installed via npm install @plausible-analytics/tracker and initialized using import Plausible from '@plausible-analytics/tracker'; const plausible = Plausible({ domain: 'yourdomain.com' });, ensuring GDPR-compliant, cookie-less measurement of visits, navigation between room tabs, gallery interaction, outbound clicks (WhatsApp, Airbnb, Instagram), booking intent, and contact intent."}`

## Feature Description

This feature implements comprehensive analytics tracking using Plausible Analytics, a privacy-focused, GDPR-compliant analytics platform. The implementation will automatically track pageviews and referrers across the entire site while also capturing specific user interactions through custom events. This enables the business to understand traffic sources, measure user engagement depth, and analyze conversion intent without compromising user privacy through cookie-less tracking.

The analytics will track three main areas:

1. **Weekly Offer page**: Track views, room tab navigation, gallery interactions, and outbound link clicks
2. **Booking page**: Track views, calendar interactions, date selections, and booking attempts
3. **Contact page**: Track views and contact method clicks

All events will include contextual properties (like which page or room) to enable detailed analysis in the Plausible dashboard.

## User Story

As a business owner
I want to track user behavior and traffic sources on the website
So that I can understand which marketing channels are effective, which rooms are most popular, and where users drop off in the booking funnel

## Problem Statement

The website currently has no analytics implementation, making it impossible to:

- Understand which marketing channels drive traffic
- Identify which rooms (room1 vs room2) generate more interest
- Measure engagement depth (do users browse galleries, read descriptions?)
- Track conversion intent (calendar opens, booking button clicks, WhatsApp clicks)
- Analyze the effectiveness of the weekly offer promotion

Without this data, business decisions about marketing spend, pricing, and content optimization are made blindly.

## Solution Statement

Implement Plausible Analytics using the official `@plausible-analytics/tracker` npm package to provide privacy-focused, cookie-less analytics. The solution includes:

1. **Automatic pageview tracking**: Every page visit is automatically tracked with referrer information
2. **Custom event tracking**: Specific user interactions are tracked with contextual properties
3. **TypeScript-safe implementation**: Create a centralized analytics utility with type-safe event definitions
4. **Client-side integration**: Events are tracked from client components where user interactions occur
5. **Environment-based configuration**: Use environment variables for the Plausible domain to support different environments

The implementation will be non-intrusive, privacy-respecting (no cookies), and GDPR-compliant by default.

## Visual Requirements from Mockup

No mockups provided in issue.

## Relevant Files

Use these files to implement the feature:

- `src/app/layout.tsx` - Root layout where Plausible script will be initialized for automatic pageview tracking
- `src/app/(main)/weekly-offer/[room]/page.tsx` - Weekly Offer page that needs tracking
- `src/app/(main)/weekly-offer/[room]/ui/WeeklyOfferTabs.tsx` - Server component with room tab links (needs client wrapper for tracking)
- `src/app/(main)/weekly-offer/[room]/ui/WeeklyOfferInfoBlock.tsx` - Contains WhatsApp and Airbnb links (needs client wrapper for tracking)
- `src/app/(main)/booking/[type]/ui/Gallery.tsx` - Client component for gallery with thumbnail clicks
- `src/app/(main)/booking/[type]/page.tsx` - Booking page that needs tracking
- `src/app/(main)/booking/[type]/ui/BookingContent.tsx` - Contains booking interactions (likely needs to be read to understand structure)
- `src/app/(main)/contact/page.tsx` - Contact page that needs tracking
- `src/app/ui/WhatsAppLink.tsx` - Reusable WhatsApp link component (needs client wrapper for tracking)
- `package.json` - For adding the Plausible Analytics dependency
- `vitest.config.ts` - Test configuration for unit and component tests
- `app_docs/testing/unit_test_spec_format.md` - Unit test specification format
- `app_docs/testing/component_test_spec_format.md` - Component test specification format
- `app_docs/testing/e2e_runner.md` - E2E test execution guide
- `app_docs/testing/e2e_example.md` - E2E test format example

### New Files

- `src/lib/analytics.ts` - Centralized analytics utility with type-safe event tracking functions
- `src/ui/ScrollTracker.tsx` - Client component to track scroll depth (50% threshold)
- `src/app/(main)/weekly-offer/[room]/ui/WeeklyOfferTabsClient.tsx` - Client wrapper for room tab clicks
- `src/app/(main)/weekly-offer/[room]/ui/TrackedWhatsAppLink.tsx` - Client wrapper for WhatsApp link with tracking
- `src/app/(main)/weekly-offer/[room]/ui/TrackedAirbnbLink.tsx` - Client wrapper for Airbnb link with tracking
- `src/app/(main)/booking/[type]/ui/BookingTabsClient.tsx` - Client wrapper for booking type tabs (if needed)
- `src/ui/InstagramLink.tsx` - Instagram link component (if it exists, otherwise create it)
- `specs/feature_68_adw_15c76fc3_plausible_analytics/unit_testing_spec.md` - Unit testing specification for analytics utility
- `specs/feature_68_adw_15c76fc3_plausible_analytics/component_testing_spec.md` - Component testing specification for tracker components
- `specs/feature_68_adw_15c76fc3_plausible_analytics/e2e_testing_spec.md` - E2E testing specification for analytics integration

## Implementation Plan

### Phase 1: Foundation

1. Install the `@plausible-analytics/tracker` npm package
2. Add environment variable for Plausible domain configuration
3. Create centralized analytics utility (`src/lib/analytics.ts`) with:
   - Type-safe event definitions for all custom events
   - Wrapper functions for each event type
   - Conditional initialization (only in browser, with domain from env)
4. Initialize Plausible in the root layout for automatic pageview tracking

### Phase 2: Core Implementation

1. **Weekly Offer Page Tracking**:
   - Create scroll tracker component for 50% scroll events
   - Create client wrapper for room tab clicks (WeeklyOfferTabsClient)
   - Create tracked wrapper components for WhatsApp and Airbnb links
   - Track page views automatically (handled by Plausible script)
   - Add scroll tracker to page layout

2. **Booking Page Tracking**:
   - Add tracking to Gallery thumbnail clicks (already client component)
   - Add tracking to booking interactions (calendar, dates, book button)
   - Create tracked wrapper for WhatsApp link on booking page
   - Track page views automatically

3. **Contact Page Tracking**:
   - Create tracked wrapper for WhatsApp link on contact page
   - Create Instagram link component with tracking (if needed)
   - Track page views automatically

### Phase 3: Integration

1. Replace server components with client wrappers where interaction tracking is needed
2. Ensure all tracked components maintain the same visual appearance and behavior
3. Add scroll tracker to relevant pages
4. Verify event properties are correctly passed (page context, room type, etc.)

## Technical Considerations

### Performance

- Plausible script is lightweight (~1KB) and loaded asynchronously
- Event tracking is non-blocking and fires asynchronously
- Scroll tracking uses passive event listeners and throttling to avoid performance impact
- No cookies means no storage overhead

### Security

- No sensitive data is tracked (no PII)
- Plausible domain is configured via environment variable
- All outbound links maintain `rel="noopener noreferrer"` for security
- Analytics tracking does not interfere with existing security measures

### Accessibility

- Tracked components maintain all existing accessibility features
- Click tracking does not prevent default link behavior
- Keyboard navigation continues to work as expected
- Screen readers are unaffected by analytics tracking

### Error Handling

- Analytics utility gracefully handles missing environment variables
- Tracking failures do not break user interactions
- Console warnings (not errors) for misconfigured analytics in development
- Defensive checks for browser-only code (window/document availability)

## Prerequisites (BLOCKING)

Complete ALL prerequisites before running /implement. These require human action and cannot be automated.

### Infrastructure Tasks

None required for this feature. Plausible Analytics is a third-party service that doesn't require database or infrastructure changes on our end.

### Environment Tasks

- [ ] **NEXT_PUBLIC_PLAUSIBLE_DOMAIN** - Domain for Plausible Analytics tracking
  - **Where**: `.env.local`
  - **Value**: The domain registered in your Plausible account (e.g., "issebya.com")
  - **Verify**: Variable exists and is not empty. Check with `echo $NEXT_PUBLIC_PLAUSIBLE_DOMAIN` or verify the value is present in `.env.local`
  - **Note**: Must be prefixed with `NEXT_PUBLIC_` to be available in the browser

---

NOTE: The /implement command will verify these prerequisites before starting code implementation. If any prerequisite fails verification, implementation will be BLOCKED until the human completes the required action.

## Step by Step Tasks

IMPORTANT: Prerequisites section above MUST be completed first. These steps assume all infrastructure and environment is ready.

IMPORTANT: Execute every step in order, top to bottom.

### 1. Install Plausible Analytics Package

- Install `@plausible-analytics/tracker` using yarn
- Verify package is added to package.json dependencies

### 2. Create Analytics Utility Library

- Create `src/lib/analytics.ts` with:
  - Type definitions for all custom events and their properties
  - Plausible initialization function that reads from `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`
  - Wrapper functions for each event type (trackWeeklyOfferViewed, trackRoomTabClick, etc.)
  - Browser-only initialization guard
  - TypeScript interfaces for event properties

### 3. Initialize Plausible in Root Layout

- Update `src/app/layout.tsx` to initialize Plausible tracking
- Add Plausible script tag in the `<head>` section for automatic pageview tracking
- Use environment variable for domain configuration
- Ensure script loads asynchronously

### 4. Create Scroll Tracking Component

- Create `src/ui/ScrollTracker.tsx` as a client component
- Implement scroll depth detection with 50% threshold
- Use passive scroll listeners with throttling for performance
- Track scroll event only once per page visit
- Accept page name as prop for event properties

### 5. Create Testing Specifications

- Create `specs/feature_68_adw_15c76fc3_plausible_analytics/e2e_testing_spec.md` following `app_docs/testing/e2e_example.md` format for E2E validation
- Create `specs/feature_68_adw_15c76fc3_plausible_analytics/unit_testing_spec.md` following `app_docs/testing/unit_test_spec_format.md` format for analytics utility
- Create `specs/feature_68_adw_15c76fc3_plausible_analytics/component_testing_spec.md` following `app_docs/testing/component_test_spec_format.md` format for client components

### 6. Implement Weekly Offer Page Tracking

- Read `src/app/(main)/booking/[type]/ui/BookingContent.tsx` to understand structure for similar patterns
- Create `src/app/(main)/weekly-offer/[room]/ui/WeeklyOfferTabsClient.tsx` client wrapper for room tab clicks
- Create `src/app/(main)/weekly-offer/[room]/ui/TrackedWhatsAppLink.tsx` for WhatsApp clicks with page context
- Create `src/app/(main)/weekly-offer/[room]/ui/TrackedAirbnbLink.tsx` for Airbnb clicks with page context
- Update `WeeklyOfferInfoBlock.tsx` to use tracked link components
- Update `page.tsx` to use client tabs component and add ScrollTracker
- Track events: WeeklyOfferViewed (automatic), RoomTabClicked, GalleryThumbnailClicked, WhatsAppClicked, AirbnbClicked, Scrolled50%

### 7. Implement Booking Page Tracking

- Update Gallery component to track thumbnail clicks
- Read and update BookingContent to track calendar interactions
- Create tracked WhatsApp link wrapper for booking page context
- Add ScrollTracker to booking page
- Track events: BookingViewed (automatic), CalendarOpened, DateSelected, BookButtonClicked, WhatsAppClicked

### 8. Implement Contact Page Tracking

- Create tracked WhatsApp link wrapper for contact page context
- Check if Instagram link exists, create `src/ui/InstagramLink.tsx` if needed
- Update contact page to use tracked components
- Track events: ContactViewed (automatic), WhatsAppClicked, InstagramClicked (if Instagram link exists)

### 9. Implement Gallery Thumbnail Tracking

- Update `src/app/(main)/booking/[type]/ui/Gallery.tsx` to track thumbnail clicks
- Pass page/room context to gallery for event properties
- Ensure tracking doesn't interfere with image selection functionality

### 10. Run Validation Commands

- Execute all validation commands to ensure feature works correctly with zero regressions
- Verify build succeeds
- Execute E2E tests to validate analytics integration

## Testing Strategy

### Edge Cases

1. **Missing environment variable**: Analytics should gracefully degrade if `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is not set
2. **Browser vs Server**: Analytics code should only execute in browser context (client components)
3. **Rapid clicks**: Multiple rapid clicks should track multiple events (no artificial throttling of clicks)
4. **Scroll tracking**: 50% scroll event should fire only once per page session
5. **Tab switching**: Room tab clicks should track even when tabs are switched rapidly
6. **Image gallery**: Thumbnail clicks should track for all images, including first and last
7. **Multiple WhatsApp links**: Each WhatsApp link should track with correct page context
8. **SSR compatibility**: Analytics should not break server-side rendering
9. **Link behavior preservation**: Tracked links should maintain all original behavior (open in new tab, etc.)
10. **Accessibility**: Tracking should not interfere with keyboard navigation or screen readers

## Cleanup Checklist

Before final validation, verify:

- [ ] Unused functions/variables removed (not commented out)
- [ ] Dead imports removed
- [ ] Components no longer used have been deleted
- [ ] Old hooks replaced by new patterns have been deleted
- [ ] No TODO comments left from implementation
- [ ] No console.log statements for debugging
- [ ] All TypeScript types are properly defined
- [ ] Environment variable is documented in .env.example (if it exists)

## Acceptance Criteria

1. **Automatic Pageview Tracking**:
   - All page visits are automatically tracked in Plausible
   - Referrer information is captured
   - No manual pageview tracking code needed on individual pages

2. **Weekly Offer Page Events**:
   - ✅ WeeklyOfferViewed event fires when page loads (automatic)
   - ✅ RoomTabClicked event fires with room property (room1 or room2)
   - ✅ GalleryThumbnailClicked event fires with image index and room context
   - ✅ WhatsAppClicked event fires with page: "Weekly Offer" property
   - ✅ AirbnbClicked event fires with room property
   - ✅ Scrolled50% event fires once when user scrolls halfway down the page

3. **Booking Page Events**:
   - ✅ BookingViewed event fires when page loads (automatic)
   - ✅ GalleryThumbnailClicked event fires with image index and booking type context
   - ✅ Calendar interactions are tracked (if calendar component exists)
   - ✅ WhatsAppClicked event fires with page: "Booking" property

4. **Contact Page Events**:
   - ✅ ContactViewed event fires when page loads (automatic)
   - ✅ WhatsAppClicked event fires with page: "Contact" property
   - ✅ Instagram clicks are tracked (if Instagram links exist)

5. **Technical Requirements**:
   - ✅ All events include relevant context properties (page, room, type, etc.)
   - ✅ Analytics library is type-safe with TypeScript
   - ✅ Tracking is cookie-less and GDPR-compliant
   - ✅ No impact on page performance or Core Web Vitals
   - ✅ Server-side rendering continues to work correctly
   - ✅ All existing functionality is preserved (links work, navigation works, etc.)

6. **Code Quality**:
   - ✅ Centralized analytics utility with consistent API
   - ✅ Client components are clearly marked with 'use client'
   - ✅ No code duplication for similar tracking scenarios
   - ✅ Environment-based configuration (no hardcoded domain)

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- E2E Tests: Read `app_docs/testing/e2e_runner.md`, then read and execute your new E2E test from `specs/feature_68_adw_15c76fc3_plausible_analytics/e2e_testing_spec.md` to validate end-to-end analytics functionality
- `yarn build` - Run frontend build to validate the feature works with zero regressions

## Notes

### Plausible Analytics Benefits

- **Privacy-focused**: No cookies, GDPR/CCPA compliant by default
- **Lightweight**: ~1KB script size vs 45KB+ for Google Analytics
- **Simple**: Clean dashboard, easy to understand metrics
- **Open source**: Can self-host if needed in the future

### Event Naming Convention

Events follow a pattern of `[Entity] [Action]` for clarity:

- `WeeklyOfferViewed` (automatic pageview)
- `RoomTabClicked`
- `GalleryThumbnailClicked`
- `WhatsAppClicked` (differentiated by page property)
- `Scrolled50%` (engagement metric)

### Environment Variable

The `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` environment variable must be set before the feature works. This should be the domain registered in your Plausible account (e.g., "issebya.com"). The `NEXT_PUBLIC_` prefix is required for Next.js to expose it to the browser.

### Future Enhancements

After initial implementation, consider:

- Goal tracking in Plausible dashboard (e.g., WhatsApp clicks as conversion goals)
- Custom properties for A/B testing different page layouts
- Revenue tracking if booking flow is added later
- Funnel analysis for weekly offer → contact → booking flow

### Package Installed

- `@plausible-analytics/tracker` - Official Plausible Analytics tracker library for custom event tracking and configuration
