import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

export default function ContactPage() {
  return (
    <div className="flex items-center justify-center min-h-[80vh] px-6">
      <div className="max-w-xl text-center space-y-6">
        <p className="text-secondary">
          For custom bookings, special requests, or any enquiries not listed on our booking page,
          we&apos;re here to help.
        </p>
        <p className="text-secondary">
          Please reach out to us directly on <WhatsAppLink />.
        </p>
      </div>
    </div>
  );
}
