import type { Metadata } from "next";
import Link from "next/link";
import { InfoSection } from "@/app/ui/InfoSection";

export const metadata: Metadata = {
  title: "Terms & Conditions – Issebya Homes",
  robots: { index: false, follow: false },
};

export default function TermsAndConditionsPage() {
  return (
    <div className="min-h-screen bg-[#f0eeea] font-sans">
      <main className="max-w-4xl mx-auto px-6 md:px-12 py-8 space-y-18">
        <div>
          <h1 className="text-4xl font-bold font-hand mb-4">Terms &amp; Conditions</h1>
          <p className="text-sm text-black">
            These terms apply to all bookings and stays at issebya.homes. By booking or staying with
            us, you agree to the terms below.
          </p>
        </div>

        <InfoSection id="operator" title="Property & Operator">
          <p>
            <strong>Property:</strong> Rua do Lagarto 5, 2705-044, Almoçageme, Portugal
          </p>
          <p>
            <strong>Operator:</strong> Sviatlana Buben, NIF 330791745
          </p>
          <p>
            <strong>Alojamento Local registration:</strong> 168673/AL
          </p>
          <p>
            <strong>Contact:</strong>{" "}
            <a href="mailto:help@issebya.com" className="underline hover:text-gray-600">
              help@issebya.com
            </a>
          </p>
          <p>
            This establishment holds mandatory civil liability insurance, as required under
            Portuguese Alojamento Local law.
          </p>
        </InfoSection>

        <InfoSection id="booking-payment" title="Booking & Payment">
          <p>
            Prices shown at checkout are all-inclusive: accommodation plus the Sintra municipal
            tourist tax (€2 per guest, per night, for the first 3 nights), where applicable. Payment
            is processed securely via Stripe at the time of booking.
          </p>
        </InfoSection>

        <InfoSection id="cancellation" title="Cancellation & Refunds">
          <p>
            Once a reservation is made, we are unable to provide a refund. Please be sure of your
            dates before booking.
          </p>
          <p>
            If something has gone wrong with your booking, please contact us at{" "}
            <a href="mailto:help@issebya.com" className="underline hover:text-gray-600">
              help@issebya.com
            </a>
            .
          </p>
          <p>
            Under Portuguese law (Decreto-Lei 24/2014), the standard 14-day right of withdrawal for
            distance contracts does not apply to accommodation bookings for a specific stay period.
            This cancellation policy governs your booking instead.
          </p>
        </InfoSection>

        <InfoSection id="check-in-registration" title="Check-in & Guest Registration">
          <p>
            <strong>Check-in:</strong> After 15:00
          </p>
          <p>
            <strong>Check-out:</strong> By 11:00
          </p>
          <p>
            There is no self check-in. The host meets guests at the property at the agreed check-in
            time.
          </p>
          <p>
            Portuguese law requires us to register the identity document (passport or national ID)
            of every foreign guest with the immigration authorities (AIMA/SIBA) within 3 business
            days of check-in. Please have a valid ID or passport ready at check-in.
          </p>
        </InfoSection>

        <InfoSection id="house-rules" title="House Rules">
          <p>
            <strong>Maximum occupancy:</strong> 2 guests per room, or 4 guests for the full house
            booking. These limits may not be exceeded.
          </p>
          <p>
            <strong>Quiet hours:</strong> 22:00 to 07:00, to support everyone&apos;s rest.
          </p>
          <p>
            <strong>Smoking:</strong> Only in the garden or on the terrace, not inside the house.
          </p>
          <p>
            <strong>Pets:</strong> Not permitted.
          </p>
          <p>
            <strong>Damage:</strong> Any damage to the property must be fully covered by the guest.
          </p>
          <p>Additional house guidelines are shared directly with guests ahead of their stay.</p>
        </InfoSection>

        <InfoSection id="privacy" title="Guest Data & Privacy">
          <p>
            We collect the personal data needed to process your booking and communicate with you,
            including your name, contact details, and WhatsApp messages. Identity documents for
            foreign-guest registration (see above) are checked in person at check-in and are not
            stored digitally by us. Full details are in our{" "}
            <Link href="/privacy-policy" className="underline hover:text-gray-600">
              Privacy Policy
            </Link>
            .
          </p>
        </InfoSection>

        <InfoSection id="complaints" title="Complaints">
          <p>
            This establishment has an electronic complaints book, available at{" "}
            <a
              href="https://www.livroreclamacoes.pt"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              www.livroreclamacoes.pt
            </a>
            .
          </p>
        </InfoSection>

        <InfoSection id="dispute-resolution" title="Alternative Dispute Resolution">
          <p>
            In case of a consumer dispute, you may resort to an Alternative Dispute Resolution (ADR)
            entity. The applicable entity for this establishment is CACCL (Centro de Arbitragem de
            Conflitos de Consumo de Lisboa), which covers Sintra municipality, or alternatively
            CNIACC (Centro Nacional de Informação e Arbitragem de Conflitos de Consumo),
            Portugal&apos;s national default entity.
          </p>
          <p>
            You may also use the European Union&apos;s Online Dispute Resolution platform, available
            at{" "}
            <a
              href="https://ec.europa.eu/consumers/odr"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              ec.europa.eu/consumers/odr
            </a>
            .
          </p>
        </InfoSection>

        <InfoSection id="governing-law" title="Governing Law">
          <p>These terms are governed by Portuguese law.</p>
        </InfoSection>
      </main>
    </div>
  );
}
