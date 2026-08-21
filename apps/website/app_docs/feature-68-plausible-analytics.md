# Plausible Analytics Integration

**ADW ID:** 15c76fc3
**Date:** 2026-02-23
**Specification:** specs/feature_68_adw_15c76fc3_plausible_analytics/implementation_spec.md

## Overview

This feature implements privacy-focused analytics using Plausible Analytics, a GDPR-compliant, cookie-less tracking solution. The integration automatically tracks pageviews and referrers while providing custom event tracking for user interactions across Booking and Contact pages.

## What Was Built

- Centralized analytics utility library with type-safe event tracking
- Automatic pageview tracking via Plausible script in root layout
- Scroll depth tracking component (50% threshold)
- Tracked link components for WhatsApp, Airbnb, and Instagram
- Tab navigation tracking for room/booking type selection
- Gallery thumbnail click tracking

## Technical Implementation

### Architecture

```
src/lib/analytics.ts          # Core analytics utility
src/app/layout.tsx            # Plausible script initialization
src/app/ui/
├── ScrollTracker.tsx         # Scroll depth tracking
├── WhatsAppLink.tsx          # Tracked WhatsApp link
├── InstagramLink.tsx         # Tracked Instagram link
├── TabsDesktop.tsx           # Tracked tab navigation (desktop)
└── TabsMobile.tsx            # Tracked tab navigation (mobile)
src/app/(main)/booking/[type]/ui/
└── Gallery.tsx               # Gallery with thumbnail tracking
```

### Files Modified

- `src/app/layout.tsx`: Added Plausible script tag with conditional rendering based on environment variable
- `src/lib/analytics.ts`: Created centralized analytics utility with type-safe event functions
- `src/app/ui/ScrollTracker.tsx`: Created scroll tracking component using `useSyncExternalStore`
- `src/app/ui/WhatsAppLink.tsx`: Added analytics tracking with page context
- `src/app/ui/InstagramLink.tsx`: Created tracked Instagram link component
- `src/app/ui/TabsDesktop.tsx`, `src/app/ui/TabsMobile.tsx`: Created shared tab components with tracking
- `src/app/(main)/booking/[type]/ui/Gallery.tsx`: Added thumbnail click tracking

### Key Changes

- **Dual tracking approach**: Plausible script handles automatic pageviews; `@plausible-analytics/tracker` package handles custom events
- **Auto pageviews disabled in tracker**: Set `autoCapturePageviews: false` to prevent duplicate pageview events
- **Dynamic imports**: Analytics tracker is dynamically imported to avoid SSR issues
- **Performance optimization**: ScrollTracker uses `useSyncExternalStore` with RAF throttling and passive listeners

## How to Use

### 1. Environment Configuration

Set the Plausible domain in `.env.local`:

```env
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=issebya.com
```

### 2. Track Custom Events

Import and call tracking functions from `src/lib/analytics.ts`:

```typescript
import { trackWhatsAppClicked, trackTabClicked } from '@/lib/analytics';

// Track a WhatsApp click with page context
trackWhatsAppClicked('Booking');

// Track a tab click with page and tab identifier
trackTabClicked('Booking', 'room1');
```

### 3. Add Scroll Tracking to a Page

```tsx
import { ScrollTracker } from '@/app/ui/ScrollTracker';

export default function Page() {
  return (
    <>
      <ScrollTracker page="Booking" />
      {/* Page content */}
    </>
  );
}
```

### 4. Use Tracked Link Components

```tsx
import { WhatsAppLink } from '@/app/ui/WhatsAppLink';
import { InstagramLink } from '@/app/ui/InstagramLink';

// WhatsApp link with tracking
<WhatsAppLink source="Contact" />

// Instagram link with tracking
<InstagramLink />
```

## Configuration

### Environment Variables

| Variable                       | Required | Description                                          |
| ------------------------------ | -------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Yes      | Domain registered in Plausible (e.g., `issebya.com`) |

The `NEXT_PUBLIC_` prefix is required for Next.js to expose the variable to browser code.

### Graceful Degradation

If the environment variable is not set:

- The Plausible script tag is not rendered
- Analytics functions log warnings but do not throw errors
- All user interactions continue to work normally

## Tracked Events

### Booking Page

| Event                     | Properties             | Trigger                     |
| ------------------------- | ---------------------- | --------------------------- |
| Pageview                  | (automatic)            | Page load                   |
| `CalendarOpened`          | -                      | User expands calendar       |
| `DateSelected`            | `startDate`, `endDate` | Date range selected         |
| `BookButtonClicked`       | -                      | User clicks book button     |
| `TabClicked`              | `page`, `tab`          | Booking type tab navigation |
| `GalleryThumbnailClicked` | `imageIndex`, `type`   | Gallery thumbnail click     |
| `WhatsAppClicked`         | `page: "Booking"`      | WhatsApp link click         |

### Contact Page

| Event              | Properties        | Trigger              |
| ------------------ | ----------------- | -------------------- |
| Pageview           | (automatic)       | Page load            |
| `WhatsAppClicked`  | `page: "Contact"` | WhatsApp link click  |
| `InstagramClicked` | -                 | Instagram link click |

## Testing

### Manual Testing

1. Open browser DevTools Network tab
2. Filter by "plausible"
3. Navigate to pages and interact with tracked elements
4. Verify requests are sent to `plausible.io/api/event`

### Verify in Plausible Dashboard

1. Log in to Plausible dashboard
2. Navigate to your site
3. Check "Goals" section for custom events
4. Verify event properties in event details

## Notes

### Performance Characteristics

- Plausible script: ~1KB (vs 45KB+ for Google Analytics)
- Events fire asynchronously without blocking UI
- Scroll tracking uses passive listeners and RAF throttling
- No cookies or local storage used

### Adding New Events

1. Define the event function in `src/lib/analytics.ts`:

```typescript
export function trackNewEvent(property: string) {
  trackEvent('NewEvent', { property });
}
```

2. Import and call from your component:

```typescript
import { trackNewEvent } from '@/lib/analytics';
trackNewEvent('value');
```

### SSR Compatibility

All analytics code includes browser checks:

- `typeof window === 'undefined'` guards
- Dynamic imports with `await import()`
- `useSyncExternalStore` with server snapshot returning 0

### Event Naming Convention

Events follow `[Entity][Action]` pattern:

- `CalendarOpened`
- `TabClicked`
- `GalleryThumbnailClicked`
- `WhatsAppClicked`
- `Scrolled50%`
