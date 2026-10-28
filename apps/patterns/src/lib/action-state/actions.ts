"use server";

import { DELAY_MS, sleep } from "./fake-api";
import type { FormState } from "./form-state";
import { nextQuantity } from "./quantity";

// Held in memory by this server instance: no database, no env vars. It
// resets when the instance does, which is fine for a demo.
let quantity = 0;

/**
 * The Server Function behind the `<form action>` stepper of the
 * `use-action-state` demo. `useActionState` calls it as a reducer, so the
 * previous state comes first and the submitted `FormData` second. The form
 * posts here without JavaScript too: React renders the page again with the
 * returned state.
 */
export async function updateQuantityForm(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const type = formData.get("type");
  if (type !== "ADD" && type !== "REMOVE") return prevState;

  await sleep(DELAY_MS);
  quantity = nextQuantity(quantity, type);
  return { quantity, savedAt: new Date().toISOString() };
}
