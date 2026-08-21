"use client";

import Image from "next/image";
import { trackInstagramClicked } from "@/lib/analytics";

export function InstagramLink() {
  return (
    <a
      href="https://www.instagram.com/issebya.homes"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram"
      className="mb-4"
      onClick={trackInstagramClicked}
    >
      <Image
        src="/instagram.webp"
        alt="Instagram"
        width={24}
        height={24}
        className="hover:opacity-70 transition-opacity"
      />
    </a>
  );
}
