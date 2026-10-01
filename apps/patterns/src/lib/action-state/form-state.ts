/**
 * The state of the `<form action>` stepper in the `use-action-state` demo.
 * Plain data only: it crosses the wire to and from the Server Function in
 * `actions.ts`, so it has to be serializable.
 */

export type FormState = { quantity: number; savedAt: string | null };

export const INITIAL_FORM_STATE: FormState = { quantity: 0, savedAt: null };
