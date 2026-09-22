"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { InfoSection } from "@/app/ui/InfoSection";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

export default function GuestInfoPage() {
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      setActiveSection(hash);

      if (hash) {
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }
    };

    // Handle initial hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const sections = [
    { id: "booking-arrival", title: "Arrival Information" },
    { id: "parking", title: "Parking" },
    { id: "house-guidelines", title: "House Guidelines" },
    { id: "waste-recycling", title: "Waste & Recycling" },
    { id: "local-essentials", title: "Local Essentials" },
    { id: "beaches-hikes", title: "Beaches & Hikes" },
    { id: "need-anything", title: "Need Anything?" },
  ];

  return (
    <div className="p-4 md:p-12">
      <h1 className="text-4xl text-header mb-6">Guest Info</h1>

      {/* Section nav */}
      <div className="relative mb-8">
        <nav className="md:overflow-visible overflow-x-auto scrollbar-hide">
          <div className="md:flex md:flex-wrap flex gap-6 text-sm min-w-max md:min-w-0">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={`pb-1 transition-colors hover:text-gray-600 whitespace-nowrap ${
                  activeSection === section.id ? "border-b-2 border-black" : ""
                }`}
              >
                {section.title}
              </a>
            ))}
          </div>
        </nav>
        {/* Fade + animated arrow to indicate scrollability, sitting on top of
            the nav's own edge rather than floating in now-thin page padding. */}
        <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#f0eeea] to-transparent pointer-events-none md:hidden flex items-center justify-end">
          <div className="animate-pulse">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="animate-bounce opacity-60"
            >
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-[70ch] space-y-18">
        <InfoSection id="booking-arrival" title="Arrival Information" titleClassName="text-price">
          <p>
            <strong>Check-in:</strong> After 15:00
          </p>
          <p>
            <strong>Check out:</strong> By 11:00
          </p>
          <p>
            <strong>Address:</strong>{" "}
            <a
              href="https://maps.app.goo.gl/3zBr4vAiyEWcszsm6"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary-link"
            >
              Rua do Lagarto 5, 2705-044, Almoçageme, Portugal
            </a>
          </p>
          <p>
            <strong>Entrance:</strong> Blue gate
          </p>
          <div className="page-decor-photo mt-4">
            <Image
              src="/bluegate.webp"
              alt="Parking area near the house"
              fill
              className="object-cover"
              sizes="(min-width: 640px) 320px, 100vw"
              preload
            />
          </div>
        </InfoSection>

        <InfoSection id="parking" title="Parking" titleClassName="text-price">
          <p>There is no private parking at the house.</p>
          <p>
            Guests typically park along the main street, there&apos;s usually space a few meters
            away.
            <a
              href="https://maps.app.goo.gl/75jxxiksPZyLixSA7"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary-link ml-1"
            >
              Park here
            </a>
          </p>
        </InfoSection>

        <InfoSection id="house-guidelines" title="House Guidelines" titleClassName="text-price">
          <div>
            <p>
              <strong>Wi-Fi</strong>
            </p>
            <p>Network and password details are shared inside the house</p>
          </div>
          <div>
            <p>
              <strong>Quiet hours</strong>
            </p>
            <p>
              Please keep shared spaces quiet from 22:00 to 07:00, to support everyone&apos;s rest.
            </p>
          </div>
          <div>
            <p>
              <strong>Shared Space Etiquette</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Keep shared areas tidy</li>
              <li>After cooking, wash dishes and pots, use the dishwasher when full</li>
              <li>Please don&apos;t leave personal belongings in shared spaces</li>
            </ul>
          </div>
        </InfoSection>

        <InfoSection id="waste-recycling" title="Waste, Recycling" titleClassName="text-price">
          <p>In the kitchen, you&apos;ll find separate bins for:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Paper</li>
            <li>Plastic & metal</li>
            <li>Glass</li>
            <li>General waste</li>
          </ul>
          <p className="mt-4">If bins are full:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              General waste goes to the
              <a
                href="https://maps.app.goo.gl/YYUzkApipx6iww3N6"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary-link mx-1"
              >
                large public bin
              </a>
              on the main road
            </li>
            <li>
              Recycling goes to the marked containers nearby
              <a
                href="https://maps.app.goo.gl/fm5ZMzk1YHz68hdBA"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary-link mx-1"
              >
                marked containers nearby
              </a>
            </li>
          </ul>
        </InfoSection>

        <InfoSection id="local-essentials" title="Local Essentials" titleClassName="text-price">
          <div className="space-y-6">
            <div>
              <p>
                <a
                  href="https://maps.app.goo.gl/bvm2LB1RJAR5wLo57"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-secondary-link mx-1"
                >
                  <strong>Amor pla Terra</strong>
                </a>
              </p>
              <p>Seasonal vegetables and fresh products</p>
            </div>
            <div>
              <p>
                <a
                  href="https://maps.app.goo.gl/s32scv7So1W4nXqJA"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-secondary-link mx-1"
                >
                  <strong>Supermarket</strong>
                </a>
              </p>
              <p>A small, reliable grocery store, 5 minutes on foot</p>
            </div>
            <div>
              <p>
                <a
                  href="https://maps.app.goo.gl/Eek71hTS9swrZvcf6"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-secondary-link mx-1"
                >
                  <strong>Pharmacy</strong>
                </a>
              </p>
              <p>Located in the center of Almoçageme</p>
            </div>
            <div>
              <p>
                <a
                  href="https://maps.app.goo.gl/j8KiG3wt2VAzBff36"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-secondary-link mx-1"
                >
                  <strong>Laundry</strong>
                </a>
              </p>
              <p>There&apos;s no washing machine in the house.</p>
              <p>The nearby laundry service is available in the village</p>
            </div>
          </div>
        </InfoSection>

        <InfoSection id="beaches-hikes" title="Beaches, Hikes" titleClassName="text-price">
          <div className="space-y-6">
            <div>
              <p>
                <strong>Beaches</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  <a
                    href="https://maps.app.goo.gl/V7WJgamGd1EQwDLw9"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Praia da Adraga
                  </a>
                  - 20 min walk / 5 min drive
                </li>
                <li>
                  <a
                    href="https://maps.app.goo.gl/17twBLuodYf6PjzD7"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Praia Grande
                  </a>
                </li>
                <li>
                  <a
                    href="https://maps.app.goo.gl/89TJjaU27Es5Xh1W8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Praia das Maçãs
                  </a>
                </li>
                <li>
                  <a
                    href="https://maps.app.goo.gl/E5WwF38FQ1rntuZZA"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Praia da Ursa
                  </a>
                  - remote, beautiful, accessed by a steep hike
                </li>
              </ul>
            </div>
            <div>
              <p>
                <strong>Hikes</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  <a
                    href="https://maps.app.goo.gl/kpAGeSDUkLRBNpyG8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Convento dos Capuchos
                  </a>
                  , forest path to a historic stone monastery
                </li>
                <li>
                  <a
                    href="https://maps.app.goo.gl/1ff4sAys3kVGby519"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Cabo da Roca
                  </a>
                  - 1h walk to the westernmost point of continental Europe
                </li>
                <li>
                  <a
                    href="https://maps.app.goo.gl/6SomJBmZpFMXoAjs5"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary-link mx-1"
                  >
                    Pedra Amarela
                  </a>
                  - forest walk with lake access
                </li>
              </ul>
            </div>
          </div>
        </InfoSection>

        <InfoSection id="need-anything" title="Need Anything?" titleClassName="text-price">
          <p>
            For help, questions, or anything else, contact us on <WhatsAppLink />.
          </p>
          <p>We&apos;re here if you need us.</p>
        </InfoSection>
      </main>
    </div>
  );
}
