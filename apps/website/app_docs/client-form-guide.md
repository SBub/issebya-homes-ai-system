# Client Form Guide

This guide covers form patterns for React client components using `useActionState`.

---

## Use useActionState for Forms

Prefer `useActionState` over manual `useState` + `onSubmit` handlers for form management.

### Why?

- Avoids unnecessary re-renders during form interaction
- Works seamlessly with server actions
- Built-in pending state via `isPending`
- Cleaner separation: action function handles logic, component handles UI
- Progressive enhancement friendly

---

## Basic Pattern

```tsx
"use client";

import { useActionState } from "react";

interface FormState {
  errors: Record<string, string>;
  generalError: string;
}

const initialState: FormState = {
  errors: {},
  generalError: "",
};

async function submitAction(prevState: FormState, formData: FormData): Promise<FormState> {
  const data = {
    name: formData.get("name") as string,
    email: formData.get("email") as string,
  };

  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) {
      if (result.errors) {
        return { errors: result.errors, generalError: "" };
      }
      return { errors: {}, generalError: result.error || "Submission failed" };
    }

    return { errors: {}, generalError: "" };
  } catch (error) {
    return { errors: {}, generalError: "Network error. Please try again." };
  }
}

export function MyForm() {
  const [state, formAction, isPending] = useActionState(submitAction, initialState);

  return (
    <form action={formAction}>
      {state.generalError && <div className="text-red-600">{state.generalError}</div>}

      <div>
        <label htmlFor="name">Name</label>
        <input name="name" id="name" required />
        {state.errors.name && <span className="text-red-600">{state.errors.name}</span>}
      </div>

      <button type="submit" disabled={isPending}>
        {isPending ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
```

---

## Passing Callbacks to Actions

If you need to call a callback (like `onSuccess`) after form submission, bind it to the action:

```tsx
async function submitOfferAction(
  onSuccess: (data: { id: string }) => void,
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  // ... handle submission ...

  if (response.ok) {
    onSuccess({ id: result.id });
    return { errors: {}, generalError: "" };
  }

  return { errors: {}, generalError: "Failed" };
}

export function CreateOfferForm({ onSuccess }: { onSuccess: (data: { id: string }) => void }) {
  const boundAction = submitOfferAction.bind(null, onSuccess);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  return <form action={formAction}>...</form>;
}
```

---

## Handling Select Components

For controlled components like Radix Select that don't work with native form data, use a hidden input:

```tsx
const [roomType, setRoomType] = useState('');

<input type="hidden" name="roomType" value={roomType} />
<Select.Root value={roomType} onValueChange={setRoomType}>
  {/* Select content */}
</Select.Root>
```

---

## Local State for Conditional UI

Only use `useState` for UI that depends on other field values (e.g., date range validation, conditional fields):

```tsx
const [startDate, setStartDate] = useState("");

<input
  name="startDate"
  type="date"
  value={startDate}
  onChange={(e) => setStartDate(e.target.value)}
/>;

{
  /* End date min depends on start date */
}
<input name="endDate" type="date" min={startDate || undefined} />;
```

---

## Avoid: Manual useState for Form State

Don't do this:

```tsx
// Avoid: causes re-renders on every keystroke
const [isSubmitting, setIsSubmitting] = useState(false);
const [errors, setErrors] = useState({});

const handleSubmit = async (e) => {
  e.preventDefault();
  setIsSubmitting(true);
  // ...
  setIsSubmitting(false);
};
```

Instead, let `useActionState` manage submission state via `isPending`.

---

## Summary

| Pattern            | Recommendation                                            |
| ------------------ | --------------------------------------------------------- |
| Form submission    | Use `useActionState` with `formAction`                    |
| Loading state      | Use `isPending` from `useActionState`                     |
| Error state        | Return errors from action, display from `state`           |
| Callbacks          | Bind to action function with `.bind(null, callback)`      |
| Controlled selects | Use hidden input + local state                            |
| Conditional fields | Only use `useState` when field values affect other fields |
