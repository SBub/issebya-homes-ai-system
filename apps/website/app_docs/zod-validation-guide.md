# Zod Data Validation Guide

This guide covers using Zod for data validation on both client and server sides, with patterns that integrate with React 19 and Next.js Server Actions.

## Installation

```bash
yarn add zod
```

Zod has first-class TypeScript support with no additional type packages needed.

---

## Schema Definition Basics

### Primitives

```typescript
import { z } from "zod";

const nameSchema = z.string().min(1, "Name is required").max(255);
const priceSchema = z.number().positive("Price must be positive");
const emailSchema = z.string().email("Invalid email format");
const isActiveSchema = z.boolean();
```

### Objects

```typescript
const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});
```

### Arrays and Enums

```typescript
// Enum from literal values
const roomTypeSchema = z.enum(["Room 1", "Room 2", "House"]);

// Array of strings
const tagsSchema = z.array(z.string());

// Array of objects
const bookingsSchema = z.array(
  z.object({
    id: z.string(),
    date: z.string(),
  }),
);
```

### Optional, Nullable, and Defaults

```typescript
const settingsSchema = z.object({
  theme: z.string().optional(), // string | undefined
  notifications: z.boolean().nullable(), // boolean | null
  pageSize: z.number().default(10), // defaults to 10 if undefined
});
```

### Date Strings

For date inputs (which arrive as strings), validate the format:

```typescript
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
```

---

## Sharing Schemas Between Client and Server

Define schemas in a shared location so both client and server use the same validation logic.

### Recommended Structure

```
src/
  schemas/
    booking.ts      # Booking-related schemas
    user.ts         # User-related schemas
    index.ts        # Re-exports
```

### Example: Checkout Schema

```typescript
// packages/shared/src/schemas/booking.ts
import { z } from "zod";

const CHECKOUT_ROOM_TYPES = ["room1", "room2"] as const;

export const checkoutSchema = z
  .object({
    roomType: z.enum(CHECKOUT_ROOM_TYPES, {
      message: "Please select a valid room type",
    }),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    personCount: z.number().int().min(1).max(2),
    email: z.string().email("Invalid email address"),
  })
  .refine((data) => new Date(data.checkOut) > new Date(data.checkIn), {
    message: "Check-out must be after check-in",
    path: ["checkOut"],
  });

// Infer TypeScript type from schema
export type CheckoutFormData = z.infer<typeof checkoutSchema>;
```

**Key benefit**: The `z.infer<>` utility generates TypeScript types directly from schemas, eliminating duplicate type definitions.

---

## Server-Side Validation

### In Server Actions

```typescript
// src/actions/booking.ts
"use server";

import { z } from "zod";
import { checkoutSchema } from "@issebya/shared/schemas/booking";

export interface FormState {
  success: boolean;
  errors: Array<{ field: string; message: string }>;
  data?: unknown;
}

export async function createCheckout(prevState: FormState, formData: FormData): Promise<FormState> {
  // Parse FormData into an object
  const rawData = {
    roomType: formData.get("roomType"),
    checkIn: formData.get("checkIn"),
    checkOut: formData.get("checkOut"),
    personCount: Number(formData.get("personCount")),
    email: formData.get("email"),
  };

  // Validate with Zod
  const result = checkoutSchema.safeParse(rawData);

  if (!result.success) {
    return {
      success: false,
      errors: formatZodErrors(result.error),
    };
  }

  // Database operations with validated data...
  // result.data is fully typed as CheckoutFormData

  return { success: true, errors: [] };
}
```

### In API Routes

```typescript
// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { checkoutSchema } from "@issebya/shared/schemas/booking";
import { formatZodErrors } from "@issebya/shared/validation";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const result = checkoutSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Validation failed",
        errors: formatZodErrors(result.error),
      },
      { status: 400 },
    );
  }

  // result.data is typed and validated
  const booking = result.data;

  // Database operations...

  return NextResponse.json({ success: true, booking });
}
```

---

## Error Formatting Utility

Create a utility to convert Zod errors to field-error pairs:

```typescript
// src/lib/validation.ts
import { z } from "zod";

export interface FieldError {
  field: string;
  message: string;
}

export function formatZodErrors(error: z.ZodError): FieldError[] {
  return error.errors.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));
}

export function zodErrorsToMap(error: z.ZodError): Record<string, string> {
  const errorMap: Record<string, string> = {};
  for (const err of error.errors) {
    const field = err.path.join(".");
    // Keep first error for each field
    if (!errorMap[field]) {
      errorMap[field] = err.message;
    }
  }
  return errorMap;
}
```

---

## Client-Side Validation

### With Uncontrolled Forms (Recommended)

Following the form re-render optimization strategy, use uncontrolled inputs with server-side validation:

```tsx
// src/ui/BookingForm.tsx
"use client";

import { useActionState } from "react";
import { createBooking, FormState } from "@/actions/booking";

const initialState: FormState = { success: false, errors: [] };

export function BookingForm() {
  const [state, formAction, isPending] = useActionState(createBooking, initialState);

  const getError = (field: string) => state.errors.find((e) => e.field === field)?.message;

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="guestName">Guest Name</label>
        <input name="guestName" id="guestName" required />
        {getError("guestName") && <span className="text-red-500">{getError("guestName")}</span>}
      </div>

      <div>
        <label htmlFor="startDate">Start Date</label>
        <input name="startDate" id="startDate" type="date" required />
        {getError("startDate") && <span className="text-red-500">{getError("startDate")}</span>}
      </div>

      <div>
        <label htmlFor="price">Price</label>
        <input name="price" id="price" type="number" step="0.01" min="0" required />
        {getError("price") && <span className="text-red-500">{getError("price")}</span>}
      </div>

      <button type="submit" disabled={isPending}>
        {isPending ? "Submitting..." : "Create Booking"}
      </button>
    </form>
  );
}
```

### Optional: Pre-Submit Client Validation

For immediate feedback before server round-trip:

```tsx
"use client";

import { useActionState, useRef } from "react";
import { checkoutSchema } from "@issebya/shared/schemas/booking";
import { zodErrorsToMap } from "@issebya/shared/validation";
import { createCheckout, FormState } from "@/actions/booking";

export function CheckoutFormWithClientValidation() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(createCheckout, {
    success: false,
    errors: [],
  });

  const handleSubmit = (formData: FormData) => {
    // Optional client-side pre-validation
    const rawData = {
      roomType: formData.get("roomType"),
      checkIn: formData.get("checkIn"),
      checkOut: formData.get("checkOut"),
      personCount: Number(formData.get("personCount")),
      email: formData.get("email"),
    };

    const result = checkoutSchema.safeParse(rawData);

    if (!result.success) {
      // Could set local error state here for instant feedback
      // But server validation will catch it too
      console.log("Client validation errors:", zodErrorsToMap(result.error));
    }

    // Always submit to server for authoritative validation
    formAction(formData);
  };

  return (
    <form ref={formRef} action={handleSubmit}>
      {/* Form fields... */}
    </form>
  );
}
```

---

## Custom Error Messages

### Inline Messages

```typescript
const schema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});
```

### Using errorMap for Enums

```typescript
const statusSchema = z.enum(["pending", "confirmed", "cancelled"], {
  errorMap: (issue, ctx) => {
    if (issue.code === "invalid_enum_value") {
      return {
        message: `Status must be one of: pending, confirmed, cancelled`,
      };
    }
    return { message: ctx.defaultError };
  },
});
```

---

## Refinements for Complex Validation

For validation rules that depend on multiple fields:

```typescript
const bookingSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
    roomType: z.enum(["Room 1", "Room 2", "House"]),
    numberOfGuests: z.number().int().min(1),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "End date must be after start date",
    path: ["endDate"], // Attach error to endDate field
  })
  .refine((data) => data.numberOfGuests <= MAX_GUESTS_BY_ROOM[data.roomType], {
    message: "Too many guests for selected room",
    path: ["numberOfGuests"],
  });
```

---

## Coercion for Form Data

Form inputs arrive as strings. Use `z.coerce` for automatic conversion:

```typescript
const formSchema = z.object({
  name: z.string(),
  age: z.coerce.number().int().positive(), // "25" -> 25
  price: z.coerce.number().positive(), // "99.99" -> 99.99
  isActive: z.coerce.boolean(), // "true" -> true
});
```

---

## Quick Reference

| Pattern                   | Use Case                    |
| ------------------------- | --------------------------- |
| `z.string().min(1)`       | Required string             |
| `z.string().optional()`   | Optional string             |
| `z.number().positive()`   | Positive number             |
| `z.coerce.number()`       | String to number conversion |
| `z.enum([...])`           | Literal union type          |
| `z.array(schema)`         | Array of items              |
| `schema.safeParse(data)`  | Parse without throwing      |
| `schema.parse(data)`      | Parse, throws on error      |
| `z.infer<typeof schema>`  | Infer TypeScript type       |
| `schema.refine(fn, opts)` | Custom validation logic     |

---

## Summary

1. **Define schemas once** in `src/schemas/` and share between client and server
2. **Use `z.infer<>`** to derive TypeScript types from schemas
3. **Always use `safeParse()`** on the server to handle errors gracefully
4. **Format errors** into field-message pairs for form display
5. **Server validation is authoritative** - client validation is optional UX enhancement
6. **Use refinements** for cross-field validation rules
