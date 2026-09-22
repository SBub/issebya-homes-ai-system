# Form Re-render Optimization Strategy

## The Core Problem

Every `useState` + controlled input pattern causes the entire component tree to re-render on each keystroke:

```tsx
// BAD: Component re-renders on EVERY character typed
const [name, setName] = useState("");
<input value={name} onChange={(e) => setName(e.target.value)} />;
```

This creates:

- Sluggish typing experience on slower devices
- Unnecessary DOM reconciliation
- Wasted CPU cycles
- Poor user experience at scale

## The Solution Hierarchy

Apply these solutions in order of preference:

### Level 1: Fully Uncontrolled (Best Performance)

Use uncontrolled inputs with `useActionState` when no dynamic behavior is needed:

```tsx
"use client";

import { useActionState } from "react";
import { submitForm } from "./actions";

function ContactForm() {
  const [state, formAction, isPending] = useActionState(submitForm, null);

  return (
    <form action={formAction}>
      <input name="name" required />
      <input name="email" type="email" required />
      <textarea name="message" />
      <button disabled={isPending}>Submit</button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

**Key points:**

- No `useState` for form data
- Inputs use `name` attribute, not `value`
- Form data collected via `FormData` on submit
- Zero re-renders during typing

---

### Level 2: Isolated Controlled Components (When Dynamic Behavior Needed)

When input constraints depend on other field values, isolate the controlled state:

**Problem scenario:**

- End date's `min` depends on start date
- Guest count's `max` depends on room type selection

**Solution: Create isolated input components**

```tsx
// EndDateInput.tsx - Only re-renders when startDate changes
"use client";

interface EndDateInputProps {
  startDate: string;
}

export function EndDateInput({ startDate }: EndDateInputProps) {
  const getMinEndDate = () => {
    if (!startDate) return new Date().toISOString().split("T")[0];
    const date = new Date(startDate);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split("T")[0];
  };

  return <input name="endDate" type="date" min={getMinEndDate()} required />;
}
```

```tsx
// GuestsInput.tsx - Only re-renders when roomType changes
"use client";

import { MAX_GUESTS_BY_ROOM, RoomType } from "@/types/booking";

interface GuestsInputProps {
  roomType: RoomType;
}

export function GuestsInput({ roomType }: GuestsInputProps) {
  const maxGuests = MAX_GUESTS_BY_ROOM[roomType];

  return (
    <input name="numberOfGuests" type="number" min={1} max={maxGuests} defaultValue={1} required />
  );
}
```

```tsx
// ParentForm.tsx - Only tracks what's needed for child components
"use client";

import { useState } from "react";
import { useActionState } from "react";
import { EndDateInput } from "./EndDateInput";
import { GuestsInput } from "./GuestsInput";

function BookingForm() {
  // ONLY track values that affect other inputs
  const [startDate, setStartDate] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("Room 1");

  const [state, formAction, isPending] = useActionState(submitBooking, null);

  return (
    <form action={formAction}>
      {/* Uncontrolled - no re-renders */}
      <input name="guestName" required />

      {/* Semi-controlled - only updates startDate state */}
      <input name="startDate" type="date" onChange={(e) => setStartDate(e.target.value)} required />

      {/* Isolated component - only re-renders when startDate changes */}
      <EndDateInput startDate={startDate} />

      {/* Semi-controlled - only updates roomType state */}
      <select
        name="roomType"
        value={roomType}
        onChange={(e) => setRoomType(e.target.value as RoomType)}
      >
        {ROOM_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      {/* Isolated component - only re-renders when roomType changes */}
      <GuestsInput roomType={roomType} />

      {/* Uncontrolled - no re-renders */}
      <input name="price" type="number" step="0.01" min="0" required />

      <button disabled={isPending}>Submit</button>
    </form>
  );
}
```

**Why this works:**

- Parent only has 2 state variables (not 6)
- Most inputs are uncontrolled (no re-renders)
- Re-renders are isolated to small child components
- Child components only re-render when their specific prop changes

---

### Level 3: Grouped Field Components (Complex Dependencies)

For complex forms with multiple interdependent field groups:

```tsx
// DateRangeFields.tsx - Encapsulates all date logic
"use client";

import { useState } from "react";

export function DateRangeFields() {
  const [startDate, setStartDate] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const minEndDate = startDate
    ? new Date(new Date(startDate).getTime() + 86400000).toISOString().split("T")[0]
    : today;

  return (
    <fieldset>
      <label>
        Start Date
        <input
          name="startDate"
          type="date"
          min={today}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
      </label>
      <label>
        End Date
        <input name="endDate" type="date" min={minEndDate} required />
      </label>
    </fieldset>
  );
}
```

**Use when:**

- Multiple fields share state dependencies
- Fields naturally form a logical group
- Group can be reused across forms

---

## Decision Matrix

| Scenario                              | Solution                           | Re-renders |
| ------------------------------------- | ---------------------------------- | ---------- |
| Static input (no dynamic constraints) | Uncontrolled with `name` attribute | 0          |
| Input depends on another field        | Isolated child component           | Only child |
| Multiple interdependent fields        | Grouped field component            | Only group |
| All fields interdependent             | Consider if truly necessary        | Full form  |

---

## Anti-Patterns to Avoid

### 1. Tracking all form data in state

```tsx
// BAD: Every keystroke re-renders everything
const [formData, setFormData] = useState({
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  zip: "",
});
```

### 2. Using refs to "optimize" controlled inputs

```tsx
// BAD: Refs don't help with controlled inputs
const inputRef = useRef<HTMLInputElement>(null);
const [value, setValue] = useState("");
<input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />;
```

### 3. Debouncing onChange handlers

```tsx
// BAD: Still re-renders, just less often
const debouncedSetValue = useMemo(() => debounce(setValue, 300), []);
<input value={value} onChange={(e) => debouncedSetValue(e.target.value)} />;
```

### 4. Using form libraries that track all values

```tsx
// CAUTION: Many form libraries (react-hook-form watch(), formik values)
// cause re-renders when tracking values
const { watch } = useForm();
const allValues = watch(); // Re-renders on every change!
```

---

## Server Action Pattern for Forms

Always pair with server-side validation:

```tsx
// actions.ts
"use server";

import { validateBooking } from "@/lib/validation";

export interface FormState {
  success: boolean;
  errors: Array<{ field: string; message: string }>;
  data?: BookingData;
}

export async function submitBooking(prevState: FormState, formData: FormData): Promise<FormState> {
  const rawData = {
    guestName: formData.get("guestName") as string,
    startDate: formData.get("startDate") as string,
    endDate: formData.get("endDate") as string,
    roomType: formData.get("roomType") as string,
    numberOfGuests: Number(formData.get("numberOfGuests")),
    price: Number(formData.get("price")),
  };

  const validation = validateBooking(rawData);

  if (!validation.isValid) {
    return { success: false, errors: validation.errors };
  }

  // Database operations...

  return { success: true, errors: [], data: result };
}
```

---

## Displaying Field Errors

Map errors to fields by name:

```tsx
function BookingForm() {
  const [state, formAction, isPending] = useActionState(submitBooking, {
    success: false,
    errors: [],
  });

  const getError = (field: string) => state.errors.find((e) => e.field === field)?.message;

  return (
    <form action={formAction}>
      <input name="guestName" required />
      {getError("guestName") && <span className="error">{getError("guestName")}</span>}

      {/* ... other fields ... */}
    </form>
  );
}
```

---

## Handling Success Callbacks

Use `useEffect` to trigger callbacks on success:

```tsx
interface FormProps {
  onSuccess: (data: BookingData) => void;
}

function BookingForm({ onSuccess }: FormProps) {
  const [state, formAction, isPending] = useActionState(submitBooking, {
    success: false,
    errors: [],
  });

  useEffect(() => {
    if (state.success && state.data) {
      onSuccess(state.data);
    }
  }, [state, onSuccess]);

  return <form action={formAction}>{/* ... */}</form>;
}
```

### Alternative: wrap the action instead of watching state

The `useEffect` above works, but watching `state` for a callback has a real cost: the callback runs on a separate, later render pass than the state update that produced it — this is the same "notifying parent components about state changes" anti-pattern from [react.dev's "You Might Not Need an Effect"](https://react.dev/learn/you-might-not-need-an-effect), generalized to an async action. In one real form this caused two observed bugs: `isPending` flipped back to `false` as soon as the action's promise resolved, before the separately-scheduled `useEffect` actually fired `window.location.href` — briefly re-enabling the submit button before the redirect happened — and a callback prop update (e.g. refreshing a parent's cached data) landed a full commit later than this component's own state update.

Prefer wrapping the action call in a plain client async function that runs the callback inline, right after `await`, in the same continuation as the interaction — not a `useEffect`:

```tsx
async function runSubmitBooking(prevState: FormState, formData: FormData): Promise<FormState> {
  const result = await submitBooking(prevState, formData);
  if (result.success && result.data) {
    onSuccess(result.data);
  }
  return result;
}

function BookingForm({ onSuccess }: FormProps) {
  const [state, formAction, isPending] = useActionState(runSubmitBooking, {
    success: false,
    errors: [],
  });

  return <form action={formAction}>{/* ... */}</form>;
}
```

This costs `action` being a literal Server Function reference — `formAction` now dispatches the wrapper, not `submitBooking` itself. `submitBooking` is still called first and is still the sole authority for validation; the wrapper only adds client-only follow-up work. For a form whose fields already require JS regardless (a calendar, a controlled picker), that trade-off is usually free.

---

## Quick Reference

1. **Default to uncontrolled** - Use `name` attributes, collect via `FormData`
2. **Track only dependencies** - Only use `useState` for values other inputs depend on
3. **Isolate dynamic inputs** - Put dependent inputs in their own components
4. **Server validates** - All validation happens in the server action
5. **HTML5 constraints for UX** - Use `min`, `max`, `required` for immediate feedback
