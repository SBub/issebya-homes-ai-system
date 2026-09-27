import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

export default function ContactPage() {
  return (
    <div className="bg-shop-card text-foreground px-4 py-8 md:px-12 md:py-12 min-h-screen">
      <div className="max-w-[70ch] space-y-4">
        <p className="text-secondary">
          For custom bookings, special requests, or any enquiries not listed on our booking page,
          we&apos;re here to help.
        </p>
        <p className="text-secondary">
          Reach out to us directly on <WhatsAppLink />.
        </p>
      </div>
    </div>
  );
}
