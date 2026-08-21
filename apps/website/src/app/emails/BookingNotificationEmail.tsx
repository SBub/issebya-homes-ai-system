import * as React from "react";

type BookingNotificationEmailProps = {
  customerEmail: string;
  roomLabel: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  personCount: number;
  basePrice: number;
  touristTax: number;
  totalAmount: number;
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function BookingNotificationEmail({
  customerEmail,
  roomLabel,
  checkIn,
  checkOut,
  nights,
  personCount,
  basePrice,
  touristTax,
  totalAmount,
}: BookingNotificationEmailProps) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>New Booking Received – issebya.homes</title>
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
        <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>New Booking Received</h1>
        <p style={{ color: "#555", marginBottom: "24px" }}>
          A new booking has been made on issebya.homes.
        </p>

        <div
          style={{
            background: "#f5f5f5",
            padding: "16px",
            marginBottom: "24px",
            borderLeft: "4px solid #111",
          }}
        >
          <p style={{ margin: "0", fontSize: "13px", color: "#555" }}>Customer email</p>
          <p style={{ margin: "4px 0 0", fontWeight: "bold", fontSize: "16px" }}>{customerEmail}</p>
        </div>

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
                {formatDate(checkIn)}
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
                {formatDate(checkOut)}
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
      </body>
    </html>
  );
}
