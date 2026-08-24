import { beforeEach, describe, expect, it, vi } from "vitest";

// booking.ts is a pure URL builder + reason-string builder now — the real
// approve/reject HITL mechanism moved to approval-gate.ts (see
// approval-gate.test.ts) and the policy decision of WHETHER sendBookingLink
// needs approval moved to run-turn.ts's APPROVAL_GATES table (see
// run-turn.test.ts). The only external boundary left in this file is
// handleBookingLinkApprovalReceived's inngest.send() relay, so that's the
// only thing mocked here.
const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

const {
  runSendBookingLink,
  buildBookingApprovalReason,
  handleBookingLinkApprovalReceived,
  BOOKING_LINK_APPROVAL_EVENT,
} = await import("@/agent/tools/booking.js");

const bookingArgs = {
  guestName: "Ana",
  email: "ana@example.com",
  room: "room1" as const,
  checkIn: "2026-09-01",
  checkOut: "2026-09-05",
};

describe("buildBookingApprovalReason", () => {
  it("builds the human-readable owner-facing reason string with European-formatted dates", () => {
    expect(buildBookingApprovalReason(bookingArgs)).toBe(
      "Ana wants to book room1 from 01-09-2026 to 05-09-2026.",
    );
  });

  it("falls back to the raw string for a date that isn't well-formed YYYY-MM-DD", () => {
    expect(buildBookingApprovalReason({ ...bookingArgs, checkIn: "20260901" })).toBe(
      "Ana wants to book room1 from 20260901 to 05-09-2026.",
    );
  });
});

describe("runSendBookingLink", () => {
  it("returns { url } built from room/checkIn/checkOut, with no nudge/approval logic of its own", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result).toEqual({ url: expect.stringContaining("/booking/room1?") });
    expect(result.url).toContain("checkIn=2026-09-01");
    expect(result.url).toContain("checkOut=2026-09-05");
  });

  it("threads the guest's phone and source=gca so the website can prefill/attribute the booking", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`phone=${encodeURIComponent("+15551234567")}`);
    expect(result.url).toContain("source=gca");
  });

  it("threads the guest's name so the website can prefill it too", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`guestName=${encodeURIComponent("Ana")}`);
  });

  it("threads the guest's email so the website can prefill it too", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`email=${encodeURIComponent("ana@example.com")}`);
  });

  it("defaults the site origin when NEXT_PUBLIC_SITE_URL isn't set", async () => {
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });
    expect(result.url).toContain("https://issebya.com/booking");

    if (original !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = original;
    }
  });
});

describe("handleBookingLinkApprovalReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("sends the booking-link approval event with the correlation id and decision", async () => {
    await handleBookingLinkApprovalReceived({ correlationId: "corr-abc-123", approved: true });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: BOOKING_LINK_APPROVAL_EVENT,
      data: { correlationId: "corr-abc-123", approved: true },
    });
  });

  it("relays a rejection the same way", async () => {
    await handleBookingLinkApprovalReceived({ correlationId: "corr-abc-123", approved: false });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: BOOKING_LINK_APPROVAL_EVENT,
      data: { correlationId: "corr-abc-123", approved: false },
    });
  });
});
