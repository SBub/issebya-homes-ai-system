"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();
  const showLogo = pathname !== "/";

  const isActive = (path: string) => pathname.startsWith(path);

  return (
    <header
      className={`flex flex-col sm:flex-row items-center px-6 py-4 md:border-b md:border-gray-300 gap-2 sm:gap-0 ${
        showLogo ? "justify-between" : "justify-center sm:justify-end"
      }`}
    >
      {showLogo && (
        <Link href="/">
          <h1 className="text-xl sm:text-3xl font-hand whitespace-nowrap relative z-10">
            issebya.homes
          </h1>
        </Link>
      )}

      <nav className="flex gap-6 pt-2 sm:pt-0">
        <Link
          href="/booking/room1"
          className={`pb-1 ${isActive("/booking") ? "border-b-2 border-black" : ""}`}
        >
          Booking
        </Link>
        <Link
          href="/contact"
          className={`pb-1 ${isActive("/contact") ? "border-b-2 border-black" : ""}`}
        >
          Contact
        </Link>
      </nav>
    </header>
  );
}
