import type { z } from "zod";

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Formats Zod validation errors into an array of field-error pairs.
 *
 * @param error - The Zod error object from validation failure
 * @returns Array of field errors with field path and error message
 */
export function formatZodErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));
}
