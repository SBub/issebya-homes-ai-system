# Data Fetching Guide

This guide covers how data is fetched and mutated in this app: Server Components read data, Server Actions write it. There is no client-side data-fetching library (no React Query, no SWR) anywhere in this codebase.

---

## Fetch data in Server Components, not client components

Reads happen in an async Server Component that calls a cached helper directly. There is no client-side loading state to manage because the data is already resolved by the time the component renders.

### Example: `BookingEngine`

```tsx
// src/app/(main)/booking/[type]/ui/BookingEngine.tsx

import { getAvailability } from "@/lib/availability";
import { mergeDateRanges } from "@/lib/date-utils";
import { BookingClient } from "./BookingClient";
import { BookingPricing } from "./BookingPricing";

// Server Component (getAvailability is "use cache"-tagged, cacheLife("hours")),
// so calling it here is a cached function call, not an uncached runtime read.
export async function BookingEngine({ roomType }: BookingEngineProps) {
  const { bookings, firstAvailable, error } = await getAvailability(roomType);
  const blockedDates = mergeDateRanges(bookings);

  return (
    <BookingClient
      roomType={roomType}
      blockedDates={blockedDates}
      defaultCheckIn={firstAvailable?.start ?? null}
      defaultCheckOut={firstAvailable?.end ?? null}
      error={error ?? null}
      pricing={<BookingPricing />}
    />
  );
}
```

The `getAvailability` helper itself declares its own cache scope with `"use cache"`, `cacheLife(...)`, and `cacheTag(...)` (in `src/lib/availability.ts`). A mutation that invalidates the read later calls `revalidateTag` with the same tag; see `actions.ts` below.

The caller (`src/app/(main)/booking/[type]/page.tsx`) wraps this Server Component in `<Suspense>` and an `<ErrorBoundary>` so a slow or failing read degrades gracefully without blocking the rest of the page.

### Why this instead of a client-side query library?

- No client bundle cost for fetching or caching logic
- No loading/error state to wire up in the component. By the time it renders, the data is there
- Caching is handled once, at the source (the helper), instead of per-consumer
- No request waterfalls from the client re-fetching after hydration

---

## Mutations go through Server Actions

Writes (creating a booking, starting a Stripe checkout) are `"use server"` functions, not client-side `fetch` calls to a route handler.

### Example: `submitBooking`

```tsx
// src/app/(main)/booking/[type]/actions.ts
"use server";

export async function submitBooking(
  roomType: "room1" | "room2",
  checkInDate: Date | null,
  checkOutDate: Date | null,
  source: "direct" | "gca",
  prevState: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  // validates input, checks availability, upserts the guest contact,
  // creates the Stripe Checkout Session, inserts a pending booking row
  // ...
}
```

On a stale-availability conflict, the action calls `revalidateTag(\`availability-${roomType}\`, { expire: 0 })` and re-reads `getAvailability` itself, returning the fresh `blockedDates` in its result so the client can update without a separate round trip.

### Wiring a Server Action to a form

The client component that owns the form calls the Server Action through `useActionState`, not a mutation hook:

```tsx
// src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx
"use client";

import { useActionState } from "react";
import { submitBooking } from "../actions";

const runSubmitBooking = async (prevState: BookingFormState, formData: FormData) => {
  const result = await submitBooking(roomType, checkInDate, checkOutDate, source, prevState, formData);
  // client-only follow-up: update local availability state, fire analytics,
  // redirect to the returned Stripe URL
  return result;
};

const [state, formAction, isPending] = useActionState(runSubmitBooking, initialState);
```

`<form action={formAction}>` is the only submission path (no `onSubmit` handler calling `fetch`). See `app_docs/client-form-guide.md` for the general `useActionState` form-handling conventions.

---

## Passing Server Component output into Client Components

A Client Component can receive the *result* of a Server Component as a prop (the "interleaving" pattern), instead of fetching that data itself:

```tsx
// BookingEngine (Server Component) renders BookingPricing (Server Component)
// and hands it to BookingClient (Client Component) as a `pricing` prop.
<BookingClient
  roomType={roomType}
  blockedDates={blockedDates}
  pricing={<BookingPricing />}
  // ...
/>
```

`BookingPricing` still renders server-side and is passed down as already-resolved `ReactNode` output. It never joins the client bundle, and `BookingClient` never has to fetch or know how to render it.

---

## Client components hold UI state only, no data fetching

`BookingClient` and `BookingEngineExpanded` are `"use client"` components, but they never fetch data. All server-sourced data (`blockedDates`, `defaultCheckIn`, `defaultCheckOut`, `error`, `pricing`) arrives as props from the Server Component above them. The `useState`/`useCallback` inside these components is for interaction state only: which dates are currently selected, whether the calendar is expanded, the pending/submitting state of the form.

There is no `useEffect` fetching on mount, and no client-side cache to invalidate: when a Server Action returns fresh `blockedDates` (e.g. after a `dates_unavailable` conflict), the client component just calls `setBlockedDates` directly with the value the action already returned.

If a future feature genuinely needs to fetch on the client (something outside a Server Component's render, e.g. in response to a user event with no matching Server Action), reach for a plain `fetch` inside an event handler first. Don't reintroduce a client-side query library for it without a concrete reason: as of this writing, nothing in this app needs one, and `react-query`/`@tanstack/react-query` is not a dependency.

---

## Summary

| Pattern                                | Use When                                                          |
| --------------------------------------- | ------------------------------------------------------------------ |
| Async Server Component + cached helper  | Reading data for a page or a component's initial render            |
| `"use cache"` / `cacheLife` / `cacheTag` on the helper | Scoping and invalidating a cached read                |
| Server Action (`"use server"`)          | Any mutation (creating a booking, checkout, DB writes)              |
| `useActionState` + `<form action={...}>` | Wiring a Server Action to a form from a client component           |
| Passing Server Component output as a prop | Rendering server-only content inside a client component's tree   |
| `useState` in a client component        | UI/interaction state only (selection, expanded/collapsed, pending) |
