import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodErrors } from "@/lib/shared/validation";

describe("formatZodErrors", () => {
  it("formats a single field error", () => {
    const schema = z.object({ name: z.string().min(1, "Name is required") });
    const result = schema.safeParse({ name: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors).toEqual([{ field: "name", message: "Name is required" }]);
    }
  });

  it("formats multiple field errors", () => {
    const schema = z.object({
      email: z.string().email("Invalid email"),
      age: z.number().min(18, "Must be 18+"),
    });
    const result = schema.safeParse({ email: "bad", age: 10 });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors).toHaveLength(2);
      expect(errors).toContainEqual({
        field: "email",
        message: "Invalid email",
      });
      expect(errors).toContainEqual({ field: "age", message: "Must be 18+" });
    }
  });

  it("joins nested path with dots", () => {
    const schema = z.object({
      address: z.object({
        city: z.string().min(1, "City required"),
      }),
    });
    const result = schema.safeParse({ address: { city: "" } });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors[0].field).toBe("address.city");
    }
  });

  it("returns empty string for root-level refinement errors", () => {
    const schema = z
      .object({ start: z.string(), end: z.string() })
      .refine((d) => d.end > d.start, { message: "End must be after start" });
    const result = schema.safeParse({ start: "2025-06-10", end: "2025-06-01" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      expect(errors[0]).toEqual({
        field: "",
        message: "End must be after start",
      });
    }
  });
});
