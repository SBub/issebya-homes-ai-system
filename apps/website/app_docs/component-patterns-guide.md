# Component Patterns Guide

This guide covers component organization and reusability patterns.

---

## DRY Principle: Extract Reusable Components

If a piece of JSX appears more than once, extract it into a reusable component.

### Why?

- Single source of truth for styling and behavior
- Easier to update (change in one place)
- Consistent appearance across the app
- Reduces copy-paste errors

### Example: WhatsApp Link

Before (repeated in multiple places):

```tsx
// In BookingContent.tsx
<a
  href="https://wa.me/351920742845"
  target="_blank"
  rel="noopener noreferrer"
  className="font-bold underline"
>
  WhatsApp (+351 920 742 845)
</a>

// Same code repeated in other files...
```

After (extracted component):

```tsx
// src/app/ui/WhatsAppLink.tsx
export function WhatsAppLink() {
  return (
    <a
      href="https://wa.me/351920742845"
      target="_blank"
      rel="noopener noreferrer"
      className="font-bold underline"
    >
      WhatsApp (+351 920 742 845)
    </a>
  );
}

// Usage
import { WhatsAppLink } from '@/app/ui/WhatsAppLink';

<p>
  Contact us on <WhatsAppLink />
</p>;
```

### Example: Callout Box

Before:

```tsx
<div className="border border-dashed p-4 text-sm bg-white">{content}</div>
```

After:

```tsx
// src/app/ui/Callout.tsx
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed p-4 text-sm bg-white">{children}</div>
  );
}

// Usage
<Callout>Your message here</Callout>;
```

### Example: Data-Driven Tabs

When multiple pages share similar tab navigation (e.g., booking tabs, room type tabs), extract a **data-driven** tabs component that accepts configuration as props.

Before (duplicated per-feature):

```tsx
// src/app/(main)/booking/ui/BookingTabsDesktop.tsx
export function BookingTabsDesktop({ type }) {
  return (
    <div className="flex border-b">
      <TabButton
        isActive={type === 'room1'}
        onClick={() => router.push('/booking/room1')}
      >
        room 1
      </TabButton>
      <TabButton
        isActive={type === 'room2'}
        onClick={() => router.push('/booking/room2')}
      >
        room 2
      </TabButton>
      {/* ... */}
    </div>
  );
}

// src/app/(main)/booking/ui/BookingTabsMobile.tsx
// Nearly identical JSX with different layout...
```

After (data-driven shared component):

```tsx
// src/app/ui/TabsDesktop.tsx
export interface Tab {
  id: string;
  label: string;
  href: string;
}

interface TabsDesktopProps {
  tabs: Tab[];
  activeTabId: string;
  page: string; // For analytics
}

export function TabsDesktop({ tabs, activeTabId, page }: TabsDesktopProps) {
  return (
    <div className="hidden md:block mb-6">
      <div className="flex border-b">
        {tabs.map((tab, index) => (
          <TabLink
            key={tab.id}
            href={tab.href}
            isActive={activeTabId === tab.id}
            onClick={() => trackTabClicked(page, tab.id)}
            className={`px-6 py-2 ${index < tabs.length - 1 ? 'border-r border-black' : ''}`}
          >
            {tab.label}
          </TabLink>
        ))}
      </div>
    </div>
  );
}
```

Usage (tab configuration defined in page):

```tsx
// src/app/(main)/booking/[type]/page.tsx
const bookingTabs = [
  {
    id: BookingType.room1,
    label: 'room 1',
    href: `/booking/${BookingType.room1}`,
  },
  {
    id: BookingType.room2,
    label: 'room 2',
    href: `/booking/${BookingType.room2}`,
  },
  {
    id: BookingType.event,
    label: 'event space',
    href: `/booking/${BookingType.event}`,
  },
];

<TabsDesktop tabs={bookingTabs} activeTabId={type} page="booking" />;
```

#### Benefits of Data-Driven Approach

- **Single implementation**: One component handles any number of tabs
- **Configuration in page**: Tab labels/routes defined where they're meaningful
- **Automatic styling**: Border logic (`isLast`) calculated dynamically
- **Analytics built-in**: Page context passed to tracking function

---

## When to Extract a Component

| Condition                                  | Action                 |
| ------------------------------------------ | ---------------------- |
| Same JSX appears 2+ times                  | Extract to component   |
| Contact information (phone, email, social) | Always use a component |
| Styled containers with consistent pattern  | Extract to component   |
| Interactive elements with shared behavior  | Extract to component   |

---

## DRY Principle: Extend Components Instead of Duplicating

When adding behavior (e.g., analytics tracking) to a shared component, **extend the existing component with props** rather than creating duplicate variants. This is a common DRY violation.

### Anti-Pattern: Creating TrackedX variants

Don't create per-feature tracked versions of the same component:

```
src/app/(main)/booking/ui/TrackedWhatsAppLink.tsx       # BAD - violates DRY
src/app/(main)/contact/ui/TrackedWhatsAppLink.tsx       # BAD - same JSX repeated
```

Each file duplicates the same JSX with only the tracking source changed. This violates the DRY principle because:

- The same link markup is repeated in multiple files
- Updating the phone number requires changes in multiple places
- Styling changes must be applied to each copy

### Correct Pattern: Parameterize the shared component

Add an optional prop to the existing shared component:

```tsx
// src/app/ui/WhatsAppLink.tsx
'use client';

import { trackWhatsAppClicked } from '@/lib/analytics';
import type { PageEventProps } from '@/lib/analytics';

interface WhatsAppLinkProps {
  source?: PageEventProps['page']; // Optional - only tracks when provided
}

export function WhatsAppLink({ source }: WhatsAppLinkProps) {
  const handleClick = source ? () => trackWhatsAppClicked(source) : undefined;

  return (
    <a
      href="https://wa.me/351920742845"
      target="_blank"
      rel="noopener noreferrer"
      className="font-bold underline"
      onClick={handleClick}
    >
      WhatsApp (+351 920 742 845)
    </a>
  );
}
```

Usage:

```tsx
<WhatsAppLink source="Booking" />      // Tracked
<WhatsAppLink source="Contact" />      // Tracked with different source
<WhatsAppLink />                       // Untracked (no analytics)
```

### Benefits

- **Single source of truth**: One component, one place to update
- **Type-safe tracking**: Source prop uses analytics type definitions
- **Backwards compatible**: Existing untracked usage continues to work
- **No duplication**: Avoid creating N copies of the same component

---

## DRY Principle: Generalize Analytics with Component Extraction

When extracting components, also generalize their associated tracking functions.

### Anti-Pattern: Feature-specific tracking functions

```tsx
// src/lib/analytics.ts
export function trackRoomTabClicked(room: string) {
  trackEvent('RoomTabClicked', { room });
}

export function trackBookingTabClicked(tab: string) {
  trackEvent('BookingTabClicked', { tab });
}
```

This leads to duplicate tracking functions for each feature using the same component pattern.

### Correct Pattern: Parameterized tracking

```tsx
// src/lib/analytics.ts
export function trackTabClicked(page: string, tab: string) {
  trackEvent('TabClicked', { page, tab });
}
```

Usage:

```tsx
onClick={() => trackTabClicked('booking', tab.id)}
```

This keeps analytics DRY alongside the component extraction.

---

## Server vs Client Components for Shared UI

When a shared component needs client-side behavior (event handlers, hooks), convert it to a client component by adding `'use client'`.

### Example: Adding onClick tracking

Before (server component - no interactivity):

```tsx
// src/app/ui/WhatsAppLink.tsx - server component
export function WhatsAppLink() {
  return <a href="...">WhatsApp</a>;
}
```

After (client component - has onClick):

```tsx
// src/app/ui/WhatsAppLink.tsx - client component
'use client';

export function WhatsAppLink({ source }) {
  const handleClick = source ? () => track(source) : undefined;
  return (
    <a href="..." onClick={handleClick}>
      WhatsApp
    </a>
  );
}
```

### When to use 'use client'

| Need                    | Component Type   |
| ----------------------- | ---------------- |
| onClick, onChange, etc. | Client           |
| useState, useEffect     | Client           |
| Browser APIs            | Client           |
| Static rendering only   | Server (default) |

---

## Component Location Rules

### Rule: No UI Outside app Folder

All UI-related code (React components, TSX files) must be inside the `app/` folder. Never create a `src/ui/` folder.

| Location                     | Correct? | Why                                       |
| ---------------------------- | -------- | ----------------------------------------- |
| `src/app/ui/`                | Yes      | Shared components within app folder       |
| `src/app/(main)/booking/ui/` | Yes      | Co-located with feature                   |
| `src/ui/`                    | **No**   | UI code outside app folder is not allowed |
| `src/components/`            | **No**   | Same reason - outside app folder          |

#### Why?

- Next.js App Router organizes all UI within `app/`
- Keeps clear separation: `app/` for UI, `lib/` for utilities, `utils/` for helpers
- Prevents confusion about import paths (`@/ui/` vs `@/app/ui/`)
- Maintains consistent project structure

#### Bad: Component outside app folder

```tsx
// src/ui/ScrollTracker.tsx - WRONG location
import { ScrollTracker } from '@/ui/ScrollTracker';
```

#### Good: Component in app/ui

```tsx
// src/app/ui/ScrollTracker.tsx - CORRECT location
import { ScrollTracker } from '@/app/ui/ScrollTracker';
```

---

### Rule: Shared vs Co-located

| Scenario                                 | Location               | Example                       |
| ---------------------------------------- | ---------------------- | ----------------------------- |
| Used across **different features/pages** | `src/app/ui/`          | Callout, WhatsAppLink, Footer |
| Used only within **same feature folder** | Co-locate with feature | BookingTabs, AdminHeader      |

### Shared Components (`src/app/ui/`)

Place a component here when it's used in **2+ different page/feature folders**:

```
src/app/ui/
  Callout.tsx        # Used in booking/ and other pages
  WhatsAppLink.tsx   # Used across multiple pages
  Header.tsx         # Site-wide
  Footer.tsx         # Site-wide
```

### Co-located Components (with feature)

Keep components **next to their page** when used only within that feature:

```
src/app/(main)/booking/
  [type]/page.tsx
  ui/
    TabButton.tsx         # Only used by BookingTabs*
    BookingTabsDesktop.tsx
    BookingTabsMobile.tsx
    BookingContent.tsx

src/app/admin/
  page.tsx
  ui/
    AdminHeader.tsx       # Only used in admin
    CreateOfferModal.tsx
```

### Decision Flowchart

1. Is the component used in **more than one feature folder**?
   - YES → Move to `src/app/ui/`
   - NO → Keep co-located with the feature

2. Feature folders are distinct routes like:
   - `src/app/(main)/booking/`
   - `src/app/(main)/guest-info/`
   - `src/app/(main)/contact/`

---

## Hook Location Rules

### Rule: Co-locate hooks with their feature

Like components, hooks should be co-located with their feature when they're only used within that feature.

| Scenario                                 | Location         | Example                    |
| ---------------------------------------- | ---------------- | -------------------------- |
| Used only within **same feature folder** | `feature/hooks/` | useAvailabilityQuery       |
| Used across **different features**       | `src/hooks/`     | useMediaQuery, useDebounce |

### Example: Feature-Specific Hook

```
src/app/(main)/booking/[type]/
  page.tsx
  hooks/
    useAvailabilityQuery.ts  # Only used by booking components
  ui/
    BookingEngine.tsx        # Uses useAvailabilityQuery
```

Don't place feature-specific hooks in `src/hooks/` - that's for truly shared utilities.

---

## Handler Placement

### Rule: Define handlers where they're used

Don't define handlers in parent components and pass them down. Define them in the component that uses them.

### Why?

- Reduces props drilling
- Keeps logic close to usage
- Easier to refactor/extract components

### Avoid: Handler in parent

```tsx
// Don't do this
function BookingEngine() {
  const handleBook = () => {
    /* booking logic */
  };
  return <BookingEngineExpanded onBook={handleBook} />;
}
```

### Prefer: Handler in the component that uses it

```tsx
// Do this
function BookingEngineExpanded() {
  const handleBook = () => {
    /* booking logic */
  };
  return <button onClick={handleBook}>Book</button>;
}
```

Exception: If the same handler is used by multiple sibling components, lift it to the nearest common ancestor.

---

## Import Path Conventions

### Rule: Use `@/` alias for cross-feature imports

When importing components from other feature folders, use the `@/` path alias instead of relative paths.

| Import Type          | Use           | Example                                                        |
| -------------------- | ------------- | -------------------------------------------------------------- |
| Same feature folder  | Relative `./` | `import { Tabs } from "./ui/Tabs"`                             |
| Cross-feature folder | Alias `@/`    | `import Gallery from "@/app/(main)/booking/[type]/ui/Gallery"` |
| Shared components    | Alias `@/`    | `import { Callout } from "@/app/ui/Callout"`                   |
| Utils/libs           | Alias `@/`    | `import { cn } from "@/lib/utils"`                             |

### Why?

- **Clarity**: Immediately obvious the import is from outside the current feature
- **Refactor-safe**: Moving files within a feature doesn't break cross-feature imports
- **Consistent**: All external imports look the same regardless of file depth

### Bad: Relative path for cross-feature import

```tsx
// In src/app/(main)/guest-info/page.tsx
import { Callout } from '../../ui/Callout'; // Fragile, unclear
```

### Good: Alias for cross-feature import

```tsx
// In src/app/(main)/guest-info/page.tsx
import { Callout } from '@/app/ui/Callout'; // Clear and stable
```

---

## Summary

- **All UI in app folder**: Never create `src/ui/` or `src/components/` - all UI lives in `app/`
- **More than once = component**: Don't wait for 3+ occurrences
- **Contact links**: Always componentize for consistency
- **Styled patterns**: Extract to maintain visual consistency
- **Extend, don't duplicate**: Add props to shared components instead of creating TrackedX variants (DRY)
- **'use client' when needed**: Add directive only when component needs event handlers or hooks
- **Cross-feature = shared**: Components used across feature folders go in `src/app/ui/`
- **Single-feature = co-located**: Components used only within one feature stay with that feature
- **Hooks follow same rules**: Co-locate feature-specific hooks, share cross-feature ones
- **Handlers belong where used**: Define handlers in the component that uses them
- **Cross-feature imports use `@/`**: Relative paths only for same-feature imports
