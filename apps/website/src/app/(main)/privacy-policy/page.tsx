import type { Metadata } from "next";
import { InfoSection } from "@/app/ui/InfoSection";

export const metadata: Metadata = {
  title: "Privacy Policy – Issebya Homes",
  robots: { index: false, follow: false },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="p-4 md:p-12">
      <h1 className="text-4xl text-header mb-6">Privacy Policy</h1>

      <main className="max-w-[70ch] space-y-18">
        <p className="text-sm leading-relaxed">
          This policy explains what personal data issebya.homes collects, why, and what rights you
          have over it. It covers our website, booking flow, and WhatsApp assistant.
        </p>

        <InfoSection id="controller" title="Who We Are" titleClassName="text-price">
          <p>
            issebya.homes is operated by Sviatlana Buben, NIF 330791745, Rua do Lagarto 5, 2705-044,
            Almoçageme, Portugal (Alojamento Local registration 168673/AL). For any question about
            this policy or your data, contact{" "}
            <a href="mailto:help@issebya.com" className="text-sm leading-relaxed underline">
              help@issebya.com
            </a>
            .
          </p>
        </InfoSection>

        <InfoSection id="what-we-collect" title="What We Collect" titleClassName="text-price">
          <p>
            <strong>Booking form:</strong> name, email, phone number, number of guests, and your
            chosen dates, when you book a room on our website.
          </p>
          <p>
            <strong>WhatsApp messages:</strong> if you message us, we keep the content of that
            conversation and your phone number, so we can respond and assist you, including across
            future stays.
          </p>
          <p>
            <strong>Identity documents:</strong> Portuguese law requires us to register foreign
            guests with the immigration authorities (AIMA/SIBA). This is done by checking your ID or
            passport in person at check-in. We do not photograph, scan, or store identity documents
            digitally.
          </p>
          <p>
            <strong>Payment:</strong> handled entirely by Stripe. We never see or store your card
            details.
          </p>
        </InfoSection>

        <InfoSection id="why-we-use-it" title="Why We Use It" titleClassName="text-price">
          <p>
            <strong>Processing your booking and stay:</strong> to fulfil our contract with you.
          </p>
          <p>
            <strong>Registering foreign guests with AIMA/SIBA:</strong> to comply with a legal
            obligation.
          </p>
          <p>
            <strong>Keeping booking and invoice records:</strong> to comply with Portuguese tax law,
            which requires these records to be kept for 10 years.
          </p>
          <p>
            <strong>Responding to you on WhatsApp:</strong> to fulfil our contract with you and
            answer your questions, including through our AI assistant (see below).
          </p>
          <p>
            <strong>Sending you updates or promotions on WhatsApp:</strong> only with your consent,
            given by opting in at booking. You can withdraw this at any time by telling us on
            WhatsApp or emailing{" "}
            <a href="mailto:help@issebya.com" className="text-sm leading-relaxed underline">
              help@issebya.com
            </a>
            .
          </p>
        </InfoSection>

        <InfoSection
          id="ai-assistant"
          title="Our WhatsApp AI Assistant"
          titleClassName="text-price"
        >
          <p>
            When you message us on WhatsApp, your conversation may be handled in part by an AI
            assistant, which can answer questions about the property and help prepare a booking for
            you. A human host reviews and approves any booking link before it is sent to you, and no
            booking or payment is ever completed automatically. You can always ask to speak with a
            human host directly.
          </p>
        </InfoSection>

        <InfoSection
          id="who-we-share-with"
          title="Who We Share Data With"
          titleClassName="text-price"
        >
          <p>
            <strong>Supabase</strong> (database hosting) stores our data in the EU, in Ireland.
          </p>
          <p>
            <strong>Stripe</strong> (payment processing), <strong>Twilio</strong> (WhatsApp
            delivery), <strong>Resend</strong> (booking confirmation emails), and{" "}
            <strong>Sentry</strong> (error monitoring) are based in the United States and are
            certified under the EU-U.S. Data Privacy Framework.
          </p>
          <p>
            <strong>Telegram</strong> (internal notifications to our team) and the infrastructure
            that runs our AI assistant and lets us monitor its performance are based outside the
            EU/EEA. For these, we rely on the European Commission&apos;s Standard Contractual
            Clauses or equivalent safeguards.
          </p>
          <p>You can ask us for more information about any of these safeguards at any time.</p>
        </InfoSection>

        <InfoSection id="retention" title="How Long We Keep Data" titleClassName="text-price">
          <p>
            <strong>Booking and invoice records:</strong> kept for 10 years, as required by
            Portuguese tax law.
          </p>
          <p>
            <strong>WhatsApp conversation history and guest preferences:</strong> kept to help us
            provide better service, including on future stays. You can ask us to delete this data at
            any time.
          </p>
        </InfoSection>

        <InfoSection id="your-rights" title="Your Rights" titleClassName="text-price">
          <p>
            Under the GDPR, you have the right to access, correct, delete, or restrict the personal
            data we hold about you, to receive a copy of it in a portable format, to object to our
            use of it, and to withdraw consent at any time. To exercise any of these, contact{" "}
            <a href="mailto:help@issebya.com" className="text-sm leading-relaxed underline">
              help@issebya.com
            </a>
            . We will respond within one month, as required by law.
          </p>
          <p>
            You also have the right to lodge a complaint with Portugal&apos;s data protection
            authority, the{" "}
            <a
              href="https://www.cnpd.pt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm leading-relaxed underline"
            >
              CNPD (Comissão Nacional de Proteção de Dados)
            </a>
            .
          </p>
        </InfoSection>

        <InfoSection id="security" title="Security" titleClassName="text-price">
          <p>
            We use reasonable technical and organisational measures to protect your data, including
            handling all payments through Stripe rather than storing card details ourselves, and
            encrypted connections between your browser or WhatsApp and our systems.
          </p>
        </InfoSection>

        <InfoSection id="changes" title="Changes to This Policy" titleClassName="text-price">
          <p>We may update this policy from time to time. Last updated: August 2026.</p>
        </InfoSection>
      </main>
    </div>
  );
}
