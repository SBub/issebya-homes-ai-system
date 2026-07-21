import { describe, expect, it } from "vitest";
import {
  type GuestContactRow,
  guestContactToNotionProperties,
} from "@/lib/notion-guest-contacts-sync.js";

const contact: GuestContactRow = {
  id: "9f2b1c3a-1234-4abc-9def-000000000001",
  guest_name: "Jane Doe",
  phone: "+351920742845",
  last_room: "room_1",
  last_stay_checkin: "2026-07-19",
  last_stay_checkout: "2026-07-22",
  total_stays: 3,
};

describe("guestContactToNotionProperties", () => {
  it("maps every field when all are populated", () => {
    const props = guestContactToNotionProperties(contact);
    expect(props.Name).toEqual({ title: [{ text: { content: "Jane Doe" } }] });
    expect(props.Phone).toEqual({ phone_number: "+351920742845" });
    expect(props["Last Room"]).toEqual({ rich_text: [{ text: { content: "room_1" } }] });
    expect(props["Last Stay Check-in"]).toEqual({ date: { start: "2026-07-19" } });
    expect(props["Last Stay Check-out"]).toEqual({ date: { start: "2026-07-22" } });
    expect(props["Total Stays"]).toEqual({ number: 3 });
    expect(props["Contact ID"]).toEqual({
      rich_text: [{ text: { content: "9f2b1c3a-1234-4abc-9def-000000000001" } }],
    });
  });

  it("omits phone/last_room/stay dates when null, rather than sending empty values", () => {
    const props = guestContactToNotionProperties({
      ...contact,
      phone: null,
      last_room: null,
      last_stay_checkin: null,
      last_stay_checkout: null,
      total_stays: 0,
    });

    expect(props.Phone).toBeUndefined();
    expect(props["Last Room"]).toBeUndefined();
    expect(props["Last Stay Check-in"]).toBeUndefined();
    expect(props["Last Stay Check-out"]).toBeUndefined();

    // Total Stays and Contact ID are always sent, even at 0.
    expect(props["Total Stays"]).toEqual({ number: 0 });
    expect(props["Contact ID"]).toEqual({
      rich_text: [{ text: { content: "9f2b1c3a-1234-4abc-9def-000000000001" } }],
    });
  });
});
