import { describe, expect, it } from "vitest";
import {
  calculateBasePrice,
  calculateNights,
  calculateTotalPrice,
  calculateTouristTax,
  formatPrice,
} from "../price-utils";
import { ROOM_PRICING } from "pricing";

const { basePrice, touristTax, touristTaxNights } = ROOM_PRICING;

describe("calculateNights", () => {
  it("returns correct number of nights for a standard stay", () => {
    const checkIn = new Date("2025-06-01");
    const checkOut = new Date("2025-06-04");
    expect(calculateNights(checkIn, checkOut)).toBe(3);
  });

  it("returns 1 for a single night stay", () => {
    const checkIn = new Date("2025-06-01");
    const checkOut = new Date("2025-06-02");
    expect(calculateNights(checkIn, checkOut)).toBe(1);
  });

  it("returns 0 when check-in equals check-out", () => {
    const date = new Date("2025-06-01");
    expect(calculateNights(date, date)).toBe(0);
  });

  it("returns negative when check-out is before check-in", () => {
    const checkIn = new Date("2025-06-05");
    const checkOut = new Date("2025-06-01");
    expect(calculateNights(checkIn, checkOut)).toBe(-4);
  });
});

describe("calculateBasePrice", () => {
  it("returns base price for 1 night", () => {
    expect(calculateBasePrice(1)).toBe(basePrice);
  });

  it("returns base price for multiple nights", () => {
    expect(calculateBasePrice(5)).toBe(5 * basePrice);
  });

  it("returns 0 for 0 nights", () => {
    expect(calculateBasePrice(0)).toBe(0);
  });
});

describe("calculateTouristTax", () => {
  it("charges per person per night for 1 night, 1 person", () => {
    expect(calculateTouristTax(1, 1)).toBe(touristTax);
  });

  it("charges for 2 persons", () => {
    expect(calculateTouristTax(1, 2)).toBe(touristTax * 2);
  });

  it("caps at max taxable nights", () => {
    expect(calculateTouristTax(touristTaxNights + 2, 1)).toBe(touristTaxNights * touristTax);
  });

  it("caps at max taxable nights with 2 persons", () => {
    expect(calculateTouristTax(10, 2)).toBe(touristTaxNights * 2 * touristTax);
  });

  it("charges for exactly the max taxable nights", () => {
    expect(calculateTouristTax(touristTaxNights, 1)).toBe(touristTaxNights * touristTax);
  });

  it("returns 0 for 0 nights", () => {
    expect(calculateTouristTax(0, 1)).toBe(0);
  });
});

describe("calculateTotalPrice", () => {
  it("returns correct breakdown for a 2-night stay, 1 person", () => {
    const checkIn = new Date("2025-06-01");
    const checkOut = new Date("2025-06-03");
    const result = calculateTotalPrice(checkIn, checkOut, 1);

    const expectedBase = 2 * basePrice;
    const expectedTax = 2 * touristTax;

    expect(result).toEqual({
      nights: 2,
      basePrice: expectedBase,
      touristTax: expectedTax,
      total: expectedBase + expectedTax,
    });
  });

  it("returns correct breakdown for a 5-night stay, 2 persons", () => {
    const checkIn = new Date("2025-07-01");
    const checkOut = new Date("2025-07-06");
    const result = calculateTotalPrice(checkIn, checkOut, 2);

    const expectedBase = 5 * basePrice;
    const expectedTax = touristTaxNights * 2 * touristTax;

    expect(result).toEqual({
      nights: 5,
      basePrice: expectedBase,
      touristTax: expectedTax,
      total: expectedBase + expectedTax,
    });
  });

  it("returns correct breakdown for a 1-night stay, 2 persons", () => {
    const checkIn = new Date("2025-08-10");
    const checkOut = new Date("2025-08-11");
    const result = calculateTotalPrice(checkIn, checkOut, 2);

    const expectedBase = basePrice;
    const expectedTax = 2 * touristTax;

    expect(result).toEqual({
      nights: 1,
      basePrice: expectedBase,
      touristTax: expectedTax,
      total: expectedBase + expectedTax,
    });
  });
});

describe("formatPrice", () => {
  it("formats an integer price with euro sign", () => {
    expect(formatPrice(65)).toBe("65€");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("0€");
  });

  it("formats a large price", () => {
    expect(formatPrice(1250)).toBe("1250€");
  });
});
