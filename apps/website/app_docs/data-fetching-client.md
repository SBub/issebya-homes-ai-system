# Client-Side Data Fetching Guide

This guide covers patterns for fetching data in client components.

---

## Prefer React Query over useState + useEffect

For client-side data fetching, use React Query (TanStack Query) instead of manual useState + useEffect patterns.

### Why?

- Built-in caching, deduplication, and background refetching
- Automatic loading/error states
- Easy cache invalidation
- No stale closure bugs from effect dependencies
- Optimistic updates support

---

## Avoid: Manual useState + useEffect

```tsx
// Don't do this
function useBookingDates({ roomType }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/availability?room=${roomType}`)
      .then((res) => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, [roomType]);

  return { data, isLoading, error };
}
```

Problems with this approach:

- Manual state management is error-prone
- No caching - fetches on every mount
- No automatic refetching when data goes stale
- Race conditions if roomType changes quickly

---

## Prefer: React Query

```tsx
// Do this
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function useAvailabilityQuery(roomType: 'room1' | 'room2') {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['availability', roomType],
    queryFn: async () => {
      const response = await fetch(`/api/availability?room=${roomType}`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}
```

---

## Setup: Providers at Feature Level

When using React Query, add the provider at the **feature layout level**, not app root. This keeps the dependency scoped to features that need it.

### Create providers.tsx in your feature folder

```tsx
// src/app/(main)/booking/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

### Wrap in your feature layout

```tsx
// src/app/(main)/booking/layout.tsx
import { Providers } from './providers';

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="booking-wrapper">{children}</div>
    </Providers>
  );
}
```

---

## Updating Query Data Locally

Use `queryClient.setQueryData` to update cached data without refetching:

```tsx
const setCheckIn = useCallback(
  (checkIn: Date | null) => {
    queryClient.setQueryData(['availability', roomType], (old) =>
      old ? { ...old, checkInDate: checkIn } : old,
    );
  },
  [queryClient, roomType],
);
```

---

## Summary

| Pattern                 | Use When                                |
| ----------------------- | --------------------------------------- |
| React Query             | Client components that fetch data       |
| useState + useEffect    | Only for non-data-fetching side effects |
| Feature-level providers | Scoping React Query to specific routes  |
| setQueryData            | Updating cache without refetch          |
