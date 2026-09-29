import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreArrivalEmail } from "@/app/emails/PreArrivalEmail";
import { WHATSAPP_URL } from "@/lib/site";
import {
  MAP_URL,
  PARKING_MAP_URL,
  preArrivalEmailSubject,
  preArrivalEmailText,
} from "../pre-arrival-email";

const props = {
  guestName: "Anna Silva",
  roomLabel: "Room 1",
  checkIn: "2026-10-01",
  checkOut: "2026-10-04",
};

describe("preArrivalEmailSubject", () => {
  it("names the check-in day", () => {
    expect(preArrivalEmailSubject("2026-10-01")).toBe(
      "Your stay at issebya.homes starts on Thursday 1 October",
    );
  });
});

describe("preArrivalEmailText", () => {
  const text = preArrivalEmailText(props);

  it.each([
    "Hello Anna,",
    "Your stay is two days away, so here is everything for your arrival.",
    "Check-in: Thursday 1 October, from 3 pm.",
    "Sveta meets you at the house",
    "Check-out: Sunday 4 October, by 11 am.",
    "Room: Room 1, ground floor",
    "Rua do Lagarto 5, 2705-044 Almoçageme, Portugal. Enter through the blue gate.",
    MAP_URL,
    PARKING_MAP_URL,
    "Please do not park next to the shop Amor Plat Terra.",
    "If anything changes, reply to this email or write to Sveta on WhatsApp.",
    WHATSAPP_URL,
    "See you soon,\nissebya.homes",
  ])("contains %j", (fragment) => {
    expect(text).toContain(fragment);
  });

  it("falls back to a plain greeting without a name", () => {
    expect(preArrivalEmailText({ ...props, guestName: null }).startsWith("Hello,")).toBe(true);
  });

  it.each(["tax", "total", "€", "/booking/confirmation", "—"])("never contains %j", (word) => {
    expect(text.toLowerCase()).not.toContain(word);
  });
});

describe("PreArrivalEmail", () => {
  const html = renderToStaticMarkup(PreArrivalEmail(props));

  it("renders the arrival lines and every link", () => {
    expect(html).toContain("Check-in: Thursday 1 October, from 3 pm.");
    expect(html).toContain("Check-out: Sunday 4 October, by 11 am.");
    expect(html).toContain(`href="${MAP_URL}"`);
    expect(html).toContain(`href="${PARKING_MAP_URL}"`);
    expect(html).toContain(`href="${WHATSAPP_URL}"`);
  });

  it.each(["€", "tax", "total", "bold"])("never contains %j", (word) => {
    expect(html.toLowerCase()).not.toContain(word);
  });
});
