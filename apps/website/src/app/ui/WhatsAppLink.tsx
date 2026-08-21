"use client";

import type { PageEventProps } from "@/lib/analytics";
import { trackWhatsAppClicked } from "@/lib/analytics";

interface WhatsAppLinkProps {
  source?: PageEventProps["page"];
}

export function WhatsAppLink({ source }: WhatsAppLinkProps) {
  const handleClick = source ? () => trackWhatsAppClicked(source) : undefined;

  return (
    <a
      href="https://wa.me/351920742845"
      target="_blank"
      rel="noopener noreferrer"
      className="font-bold underline"
      onClick={handleClick}
    >
      WhatsApp (+351 920 742 845)
    </a>
  );
}
