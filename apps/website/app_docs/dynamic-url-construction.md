# Dynamic URL Construction Guide

This document defines rules for constructing URLs in Next.js API routes without hardcoding base URLs.

## Problem

Hardcoding base URLs—even in environment variables—creates maintenance burden and deployment friction:

```typescript
// Avoid this pattern
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const confirmationUrl = `${baseUrl}/booking/${booking.access_token}`;
```

Issues with this approach:

- Requires configuring `NEXT_PUBLIC_BASE_URL` for each environment
- Fallback to `localhost:3000` can leak into production if env var is missing
- The path (`/booking/{token}`) is what matters—it's the same across all environments

## Solution: Derive URL from Request

In Next.js API routes, extract the origin from the incoming request:

```typescript
export async function POST(request: NextRequest) {
  // Derive origin from the request itself
  const origin = new URL(request.url).origin;

  // Construct full URL using derived origin
  const confirmationUrl = `${origin}/booking/${booking.access_token}`;
}
```

This works automatically on any host—localhost, staging, production—without configuration.

### Alternative: Using nextUrl

```typescript
export async function POST(request: NextRequest) {
  const { protocol, host } = request.nextUrl;
  const origin = `${protocol}//${host}`;

  const confirmationUrl = `${origin}/booking/${booking.access_token}`;
}
```

## When to Use Relative Paths

For client-side navigation or links rendered in React components, prefer relative paths:

```tsx
// Client component - just use the path
<Link href={`/booking/${booking.access_token}`}>View Booking</Link>
```

Only construct full URLs when:

- Generating links for external use (emails, SMS, QR codes)
- Returning URLs in API responses that will be used outside the app

## AI Agent Rules

### Always Derive Base URL from Request

When writing API route handlers that need to construct full URLs:

1. **DO** use `new URL(request.url).origin` to get the base URL
2. **DO NOT** use `process.env.NEXT_PUBLIC_BASE_URL` or similar env vars for base URLs
3. **DO NOT** hardcode URLs like `http://localhost:3000`

### Path is the Contract

The path structure (e.g., `/booking/:token`) is the stable contract. The host varies by environment and should be derived dynamically.
