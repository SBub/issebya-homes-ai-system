import { fromCalendarDay } from "@/lib/date-utils";
import { WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site";
import { firstName } from "./pre-arrival";

/**
 * Every sentence of the pre-arrival email, written once. Both the React
 * template (`PreArrivalEmail.tsx`) and the plain-text alternative below read
 * from here, so the two bodies cannot drift apart. The email carries arrival
 * facts only: no prices, tourist tax, totals or confirmation link.
 */

export const MAP_URL = "https://maps.app.goo.gl/3zBr4vAiyEWcszsm6";
export const PARKING_MAP_URL = "https://maps.app.goo.gl/75jxxiksPZyLixSA7";

export const INTRO_LINE = "Your stay is two days away, so here is everything for your arrival.";
const ROOM_LINE_TAIL =
  "ground floor, with its own bathroom. Living room, kitchen and terrace are shared.";
export const ADDRESS_LINE =
  "Address: Rua do Lagarto 5, 2705-044 Almoçageme, Portugal. Enter through the blue gate.";
// The parking sentence is split around its map link.
export const PARKING_LEAD =
  "Parking: there is no private parking. Guests park along the main street, usually a few metres away";
export const PARKING_TAIL = "Please do not park next to the shop Amor Plat Terra.";
// The contact sentence ends with the word "WhatsApp", which the HTML links.
export const CONTACT_LEAD = "If anything changes, reply to this email or write to Sveta on";
export const SIGN_OFF = "See you soon,";
export const SIGNATURE = "issebya.homes";

export type PreArrivalEmailProps = {
  guestName: string | null;
  roomLabel: string;
  checkIn: string;
  checkOut: string;
};

function formatArrivalDate(day: string): string {
  return fromCalendarDay(day).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function preArrivalEmailSubject(): string {
  return "Your stay at issebya.homes is coming soon";
}

export function greetingLine(guestName: string | null): string {
  const first = firstName(guestName);
  return first ? `Hello ${first},` : "Hello,";
}

export function checkInLine(checkIn: string): string {
  return `Check-in: ${formatArrivalDate(checkIn)}, from 3 pm. There is no self check-in: Sveta meets you at the house at the time you agree with her, so please reply with your expected arrival time.`;
}

export function checkOutLine(checkOut: string): string {
  return `Check-out: ${formatArrivalDate(checkOut)}, by 11 am.`;
}

export function roomLine(roomLabel: string): string {
  return `Room: ${roomLabel}, ${ROOM_LINE_TAIL}`;
}

export function preArrivalEmailText(props: PreArrivalEmailProps): string {
  return [
    greetingLine(props.guestName),
    INTRO_LINE,
    checkInLine(props.checkIn),
    checkOutLine(props.checkOut),
    roomLine(props.roomLabel),
    ADDRESS_LINE,
    `Map: ${MAP_URL}`,
    `${PARKING_LEAD} (${PARKING_MAP_URL}). ${PARKING_TAIL}`,
    `${CONTACT_LEAD} WhatsApp.\nWhatsApp: ${WHATSAPP_DISPLAY_NUMBER}, ${WHATSAPP_URL}`,
    `${SIGN_OFF}\n${SIGNATURE}`,
  ].join("\n\n");
}
