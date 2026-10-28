"use client";

import posthog from "posthog-js";
import { WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site";

export function WhatsAppLink() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="text-secondary-link-bold"
      onClick={() => {
        posthog.capture("whatsapp_link_clicked");
      }}
    >
      WhatsApp ({WHATSAPP_DISPLAY_NUMBER})
    </a>
  );
}
