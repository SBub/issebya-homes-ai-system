import { format } from "date-fns";

export type BookingRecord = {
  id: string;
  check_in: string; // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  created_at: string;
};

function formatICalDate(dateString: string): string {
  // Format as YYYYMMDD for all-day events
  return dateString.replace(/-/g, "");
}

function formatDtStamp(dateString: string): string {
  // Format as YYYYMMDDTHHMMSSZ
  const date = new Date(dateString);
  return format(date, "yyyyMMdd'T'HHmmss'Z'");
}

export function generateICalFeed(bookings: BookingRecord[]): string {
  const events = bookings
    .map((booking) => {
      const dtStart = formatICalDate(booking.check_in);
      const dtEnd = formatICalDate(booking.check_out);
      const dtStamp = formatDtStamp(booking.created_at);
      const uid = `${booking.id}@issebya.homes`;

      return [
        "BEGIN:VEVENT",
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:Booking ${booking.id}`,
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Issebya Homes//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    events,
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
