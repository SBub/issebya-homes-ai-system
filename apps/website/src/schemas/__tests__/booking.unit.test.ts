import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@/lib/shared/schemas/booking";

describe("checkoutSchema", () => {
  const validData = {
    roomType: "room1",
    checkIn: "2025-07-01",
    checkOut: "2025-07-04",
    personCount: 2,
    email: "guest@example.com",
  };

  it("accepts valid booking data", () => {
    const result = checkoutSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  // roomType
  it("rejects invalid room type", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      roomType: "room3",
    });
    expect(result.success).toBe(false);
  });

  // date format
  it("rejects invalid check-in date format", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      checkIn: "07/01/2025",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid check-out date format", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      checkOut: "2025-7-4",
    });
    expect(result.success).toBe(false);
  });

  // personCount
  it("rejects 0 persons", () => {
    const result = checkoutSchema.safeParse({ ...validData, personCount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects more than 2 persons", () => {
    const result = checkoutSchema.safeParse({ ...validData, personCount: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer person count", () => {
    const result = checkoutSchema.safeParse({ ...validData, personCount: 1.5 });
    expect(result.success).toBe(false);
  });

  // email
  it("rejects invalid email", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  // refinement: check-out must be after check-in
  it("rejects when check-out is before check-in", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      checkIn: "2025-07-04",
      checkOut: "2025-07-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("checkOut");
    }
  });

  it("rejects when check-out equals check-in", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      checkIn: "2025-07-01",
      checkOut: "2025-07-01",
    });
    expect(result.success).toBe(false);
  });
});
