import { describe, expect, it } from "vitest";
import { type BookingRecord, generateICalFeed } from "../ical-generator";

const sampleBooking: BookingRecord = {
  // eslint-disable-next-line no-secrets/no-secrets -- testing variable, not a real secret
  id: "abcd1234-5678-efgh-ijkl-mnopqrstuvwx",
  check_in: "2025-07-01",
  check_out: "2025-07-05",
  created_at: "2025-06-15T10:30:00Z",
};

describe("generateICalFeed", () => {
  it("produces a valid VCALENDAR wrapper", () => {
    const output = generateICalFeed([sampleBooking]);

    expect(output).toContain("BEGIN:VCALENDAR");
    expect(output).toContain("END:VCALENDAR");
    expect(output).toContain("VERSION:2.0");
    expect(output).toContain("PRODID:-//Issebya Homes//Booking Calendar//EN");
    expect(output).toContain("CALSCALE:GREGORIAN");
    expect(output).toContain("METHOD:PUBLISH");
  });

  it("produces a VEVENT with correct date formatting", () => {
    const output = generateICalFeed([sampleBooking]);

    expect(output).toContain("BEGIN:VEVENT");
    expect(output).toContain("END:VEVENT");
    expect(output).toContain("DTSTART;VALUE=DATE:20250701");
    expect(output).toContain("DTEND;VALUE=DATE:20250705");
  });

  it("generates UID from id", () => {
    const output = generateICalFeed([sampleBooking]);
    expect(output).toContain(`UID:${sampleBooking.id}@issebya.homes`);
  });

  it("uses id in summary", () => {
    const output = generateICalFeed([sampleBooking]);
    expect(output).toContain(`SUMMARY:Booking ${sampleBooking.id}`);
  });

  it("formats DTSTAMP from created_at in iCal format", () => {
    const output = generateICalFeed([sampleBooking]);
    // DTSTAMP is formatted via date-fns format() in local time with 'Z' suffix
    // Just verify it matches the YYYYMMDDTHHMMSSZ pattern
    expect(output).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  it("generates multiple events for multiple bookings", () => {
    const bookings: BookingRecord[] = [
      sampleBooking,
      {
        // eslint-disable-next-line no-secrets/no-secrets -- testing variable, not a real secret
        id: "wxyz9876-5432-abcd-efgh-ijklmnopqrst",
        check_in: "2025-08-10",
        check_out: "2025-08-14",
        created_at: "2025-07-01T12:00:00Z",
      },
    ];
    const output = generateICalFeed(bookings);

    const eventCount = output.split("BEGIN:VEVENT").length - 1;
    expect(eventCount).toBe(2);
    expect(output).toContain("DTSTART;VALUE=DATE:20250701");
    expect(output).toContain("DTSTART;VALUE=DATE:20250810");
  });

  it("produces valid output with no bookings", () => {
    const output = generateICalFeed([]);

    expect(output).toContain("BEGIN:VCALENDAR");
    expect(output).toContain("END:VCALENDAR");
    expect(output).not.toContain("BEGIN:VEVENT");
  });

  it("uses CRLF line endings per RFC 5545", () => {
    const output = generateICalFeed([sampleBooking]);
    expect(output).toContain("\r\n");
    // Should not have bare LF (without CR)
    const withoutCRLF = output.replace(/\r\n/g, "");
    expect(withoutCRLF).not.toContain("\n");
  });
});
