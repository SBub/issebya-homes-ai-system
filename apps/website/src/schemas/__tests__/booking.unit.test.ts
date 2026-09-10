import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@/lib/shared/schemas/booking";

describe("checkoutSchema", () => {
  const validData = {
    roomType: "room1",
    checkIn: "2025-07-01",
    checkOut: "2025-07-04",
    personCount: 2,
    email: "guest@example.com",
    guestName: "Guest Example",
    phone: "+14155552671",
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

  // These now arrive from the browser rather than being formatted by the
  // server, so the shape check is a trust boundary. A regex alone would let
  // the well-shaped ones through.
  it.each([
    ["a day that is not on the calendar", "2025-02-31"],
    ["a month that does not exist", "2025-13-01"],
    ["a non-leap 29 February", "2025-02-29"],
    ["an instant rather than a day", "2025-07-01T00:00:00.000Z"],
    ["an empty string", ""],
  ])("rejects check-in that is %s", (_label, checkIn) => {
    const result = checkoutSchema.safeParse({ ...validData, checkIn });
    expect(result.success).toBe(false);
  });

  it("accepts a real leap day", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      checkIn: "2024-02-29",
      checkOut: "2024-03-02",
    });
    expect(result.success).toBe(true);
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

  it("rejects an empty guest name", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      guestName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing guest name", () => {
    const { guestName: _guestName, ...withoutName } = validData;
    const result = checkoutSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  // phone
  it("rejects an invalid phone number", () => {
    const result = checkoutSchema.safeParse({
      ...validData,
      phone: "not-a-phone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing phone number", () => {
    const { phone: _phone, ...withoutPhone } = validData;
    const result = checkoutSchema.safeParse(withoutPhone);
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
