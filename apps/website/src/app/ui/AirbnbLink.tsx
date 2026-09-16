"use client";

import posthog from "posthog-js";

export function AirbnbLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm underline hover:text-gray-600"
      onClick={() => {
        posthog.capture("airbnb_link_clicked");
      }}
    >
      Read public reviews on Airbnb
    </a>
  );
}
