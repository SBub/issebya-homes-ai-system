"use client";

import posthog from "posthog-js";

export function WhatsAppLink() {
  return (
    <a
      href="https://wa.me/351920742845"
      target="_blank"
      rel="noopener noreferrer"
      className="font-bold underline"
      onClick={() => {
        posthog.capture("whatsapp_link_clicked");
      }}
    >
      WhatsApp (+351 920 742 845)
    </a>
  );
}
