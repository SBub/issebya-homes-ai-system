import * as React from "react";
import { fromCalendarDay } from "@/lib/date-utils";

type BookingConfirmationEmailProps = {
  roomLabel: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  personCount: number;
  basePrice: number;
  touristTax: number;
  totalAmount: number;
  confirmationUrl: string;
};

function formatDate(dateString: string): string {
  // A stored calendar day ("yyyy-MM-dd"), not an instant: parse it at local
  // midnight so the guest is shown the day they picked, whatever timezone
  // this renders in.
  return fromCalendarDay(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function BookingConfirmationEmail({
  roomLabel,
  checkIn,
  checkOut,
  nights,
  personCount,
  basePrice,
  touristTax,
  totalAmount,
  confirmationUrl,
}: BookingConfirmationEmailProps) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Booking Confirmed – issebya.homes</title>
      </head>
      <body
        style={{
          fontFamily: "sans-serif",
          color: "#111",
          maxWidth: "600px",
          margin: "0 auto",
          padding: "24px",
        }}
      >
        <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>Booking Confirmed</h1>
        <p style={{ color: "#555", marginBottom: "24px" }}>
          Thank you for your reservation at issebya.homes.
        </p>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "24px",
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Room
              </td>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                {roomLabel}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Check-in
              </td>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                {formatDate(checkIn)}, after 15:00
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Check-out
              </td>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                {formatDate(checkOut)}, before 11:00
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Nights
              </td>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                {nights}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Guests
              </td>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                {personCount}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Room price
              </td>
              <td style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
                {"\u20AC"}
                {basePrice}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #eee",
                  color: "#555",
                  fontSize: "13px",
                }}
              >
                Tourist tax
              </td>
              <td style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
                {"\u20AC"}
                {touristTax}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 0", color: "#555", fontSize: "13px" }}>Total</td>
              <td
                style={{
                  padding: "8px 0",
                  fontWeight: "bold",
                  fontSize: "18px",
                }}
              >
                {"\u20AC"}
                {totalAmount}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "13px", color: "#555", marginBottom: "24px" }}>
          48 hours before your arrival, we&apos;ll send you the exact address, parking details, and
          all essential information for your stay.
        </p>

        <a
          href={confirmationUrl}
          style={{
            display: "inline-block",
            marginTop: "24px",
            padding: "12px 24px",
            background: "#111",
            color: "#fff",
            textDecoration: "none",
            fontWeight: "bold",
          }}
        >
          View your reservation →
        </a>
      </body>
    </html>
  );
}
