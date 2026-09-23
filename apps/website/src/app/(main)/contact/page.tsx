import Image from "next/image";
import { Callout } from "@/app/ui/Callout";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

export default function ContactPage() {
  return (
    <div className="p-4 md:p-12">
      <div className="page-decor-photo mb-8">
        <Image
          src="/frontyard.webp"
          alt="Front yard and garden entrance"
          fill
          className="object-cover"
          sizes="(min-width: 640px) 320px, 100vw"
        />
      </div>

      <div className="max-w-[70ch] space-y-4">
        <p className="text-secondary">
          For custom bookings, special requests, or any enquiries not listed on our booking page,
          we&apos;re here to help.
        </p>
        <Callout>
          Please reach out to us directly on <WhatsAppLink />.
        </Callout>
      </div>
    </div>
  );
}
