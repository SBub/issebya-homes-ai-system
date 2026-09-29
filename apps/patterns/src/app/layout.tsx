import type { Metadata } from "next";
import { Nothing_You_Could_Do, Work_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work" });
const nothing = Nothing_You_Could_Do({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hand",
});

export const metadata: Metadata = {
  title: "Patterns - issebya.homes",
  description: "The React and Next patterns proven in the issebya.homes codebase.",
  // An internal tool, not part of the public site.
  robots: { index: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div
          className={`${workSans.variable} ${nothing.variable} font-sans bg-[#f0eeea] min-h-screen flex flex-col`}
        >
          <header className="px-4 py-4 md:px-12 border-b border-gray-300">
            <Link href="/" className="font-hand text-2xl">
              patterns
            </Link>
          </header>
          <main className="flex-1 px-4 py-8 md:px-12 md:py-12">{children}</main>
        </div>
      </body>
    </html>
  );
}
