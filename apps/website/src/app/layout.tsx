import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import { Nothing_You_Could_Do, Work_Sans } from "next/font/google";

// Load fonts
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work" });
const nothing = Nothing_You_Could_Do({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hand",
});

export const metadata: Metadata = {
  title: "issebya.homes – a private room or intimate event space",
  description:
    "We offer two private rooms with shared spaces, or the full house for intimate gatherings — nestled in Almoçageme within the Sintra-Cascais Natural Park.",
  openGraph: {
    title: "issebya.homes – a private room or intimate event space",
    description:
      "We offer two private rooms with shared spaces, or the full house for intimate gatherings — nestled in Almoçageme within the Sintra-Cascais Natural Park.",
    url: "https://issebya.com",
    type: "website",
    images: [
      {
        url: "https://issebya.com/living_room.webp",
        alt: "issebya.homes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "issebya.homes – a private room or intimate event space",
    description:
      "We offer two private rooms with shared spaces, or the full house for intimate gatherings — nestled in Almoçageme within the Sintra-Cascais Natural Park.",
    images: ["https://issebya.com/living_room.webp"],
  },
};

export default function RootLayout({
  // Layouts must accept a children prop.
  // This will be populated with nested layouts or pages
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div
          className={`${workSans.variable} ${nothing.variable} font-sans bg-[#f0eeea] min-h-screen flex flex-col`}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
