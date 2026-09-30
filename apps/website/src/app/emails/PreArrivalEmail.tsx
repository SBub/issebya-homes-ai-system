import * as React from "react";
import {
  ADDRESS_LINE,
  checkInLine,
  checkOutLine,
  CONTACT_LEAD,
  greetingLine,
  INTRO_LINE,
  MAP_URL,
  PARKING_LEAD,
  PARKING_MAP_URL,
  PARKING_TAIL,
  type PreArrivalEmailProps,
  preArrivalEmailSubject,
  roomLine,
  SIGN_OFF,
  SIGNATURE,
} from "@/lib/bookings/pre-arrival-email";
import { WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site";

const paragraph = { margin: "0 0 16px", lineHeight: "1.5" };
const link = { color: "#111" };

export function PreArrivalEmail(props: PreArrivalEmailProps) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>{preArrivalEmailSubject()}</title>
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
        <p style={paragraph}>{greetingLine(props.guestName)}</p>
        <p style={paragraph}>{INTRO_LINE}</p>
        <p style={paragraph}>{checkInLine(props.checkIn)}</p>
        <p style={paragraph}>{checkOutLine(props.checkOut)}</p>
        <p style={paragraph}>{roomLine(props.roomLabel)}</p>
        <p style={paragraph}>
          {ADDRESS_LINE}{" "}
          <a href={MAP_URL} style={link}>
            View on the map
          </a>
        </p>
        <p style={paragraph}>
          {PARKING_LEAD} (
          <a href={PARKING_MAP_URL} style={link}>
            main street map
          </a>
          ). {PARKING_TAIL}
        </p>
        <p style={paragraph}>
          {CONTACT_LEAD}{" "}
          <a href={WHATSAPP_URL} style={link}>
            WhatsApp
          </a>{" "}
          ({WHATSAPP_DISPLAY_NUMBER}).
        </p>
        <p style={paragraph}>
          {SIGN_OFF}
          <br />
          {SIGNATURE}
        </p>
      </body>
    </html>
  );
}
