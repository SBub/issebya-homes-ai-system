"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { InfoSection } from "@/app/(main)/guest-info/ui/InfoSection";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function getHash() {
  return window.location.hash.slice(1);
}
function getServerHash() {
  return "";
}

const sections = [
  { id: "getting-in", title: "Getting In" },
  { id: "your-keys", title: "Your Keys" },
  { id: "your-space", title: "Your Space" },
  { id: "house-guidelines", title: "House Guidelines" },
  { id: "lights", title: "Lights" },
  { id: "kitchen", title: "Kitchen" },
  { id: "dishwasher", title: "Dishwasher" },
  { id: "safety", title: "Safety" },
  { id: "trash", title: "Trash" },
  { id: "mosquito-protection", title: "Mosquito Protection" },
  { id: "guests", title: "Guests" },
];

interface CheckinTemplateProps {
  // Fragment hash gates access. It's never sent to the server (no server
  // logs, no Referer leak), but it still ships inside the page's JS bundle,
  // so this is obscurity for a private link, not real access control.
  hash: string;
  guestName: string;
  roomTourGifSrc: string;
  kitchenDryShelfPosition: "top" | "bottom";
  kitchenFridgeShelves: string;
  showNightLight: boolean;
  guestsExtraLines?: string[];
}

export function CheckinTemplate({
  hash,
  guestName,
  roomTourGifSrc,
  kitchenDryShelfPosition,
  kitchenFridgeShelves,
  showNightLight,
  guestsExtraLines = [],
}: CheckinTemplateProps) {
  const urlHash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const authorized = urlHash === hash;
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    if (!authorized) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [authorized]);

  const handleNavClick = (id: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setActiveSection(id);
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-[#f0eeea] font-sans flex items-center justify-center px-6">
        <p className="text-sm text-gray-500">This link isn&apos;t valid.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0eeea] font-sans">
      {/* Header */}
      <header className="bg-[#f0eeea]">
        <div className="max-w-4xl mx-auto py-8 relative">
          <div className="px-6 md:px-12">
            <nav className="md:overflow-visible overflow-x-auto scrollbar-hide mb-10">
              <div className="md:flex md:flex-wrap flex gap-6 text-sm min-w-max md:min-w-0">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={handleNavClick(section.id)}
                    className={`pb-1 transition-colors hover:text-gray-600 whitespace-nowrap ${
                      activeSection === section.id ? "border-b-2 border-black" : ""
                    }`}
                  >
                    {section.title}
                  </button>
                ))}
              </div>
            </nav>
            <h1 className="text-4xl font-bold font-hand mb-6">Hi {guestName},</h1>
            <p className="text-sm mb-6">
              So sorry I can&apos;t be there to welcome you in person. Everything you need is here.
            </p>
          </div>
          {/* Animated arrow to indicate scrollability - positioned in padding area */}
          <div className="absolute top-1/2 right-2 transform -translate-y-1/2 pointer-events-none md:hidden">
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
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 md:px-12 pb-8 space-y-18">
        <InfoSection id="getting-in" title="Getting In" titleClassName="font-sans">
          <p>
            Find the key locker at the side of the house.{" "}
            <a
              href="https://maps.app.goo.gl/MPfqEshj78Z1RoNP8"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              See map
            </a>
          </p>
          <p>
            <strong>Code:</strong> 3830
          </p>
          <p>
            Once you have your key, please shuffle the numbers so the code isn&apos;t visible to
            anyone. Your room key will be waiting inside your room.
          </p>
          <p>
            Please return the house key to the locker right away once you&apos;ve let yourself in
            and retrieved your room key.
          </p>
          <p>
            {"Please send me a message on "}
            <WhatsAppLink />
            {" once you've arrived."}
          </p>
          <Image
            src="/checkin-room1-locker.gif"
            alt="Directions to the key locker"
            width={152}
            height={86}
            unoptimized
            className="mt-4 w-full max-w-md shadow-md"
          />
        </InfoSection>

        <InfoSection id="your-keys" title="Your Keys" titleClassName="font-sans">
          <p>You&apos;ll find a key set in your room:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>House key:</strong>{" "}
              {
                "front door (please lock the house for the night and when you leave the house and there is no one, so the house doesn't stay unattended)"
              }
            </li>
            <li>
              <strong>Gate key:</strong>{" "}
              {"to close the gate, push firmly; it makes a loud sound, that's completely normal"}
            </li>
            <li>
              <strong>Room key</strong>
            </li>
          </ul>
        </InfoSection>

        <InfoSection id="your-space" title="Your Space" titleClassName="font-sans">
          <p>
            Your bedroom and bathroom are private. The rest of the house, kitchen, living areas, is
            shared with other guests.
          </p>
          <Image
            src={roomTourGifSrc}
            alt="Video tour of your bedroom and bathroom"
            width={426}
            height={240}
            unoptimized
            className="mt-4 w-full max-w-md shadow-md"
          />
        </InfoSection>

        <InfoSection id="house-guidelines" title="House Guidelines" titleClassName="font-sans">
          <div>
            <p>
              <strong>Wifi</strong>
            </p>
            <p>
              You&apos;ll find the network name and password in the guest book on the dining table.
            </p>
          </div>
          <div>
            <p>
              <strong>Shoes</strong>
            </p>
            <p>Please take your shoes off at the door, we keep the house shoe-free.</p>
          </div>
          <div>
            <p>
              <strong>Shared Space Etiquette</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Please keep shared spaces organized</li>
              <li>Avoid leaving personal belongings in shared areas</li>
            </ul>
          </div>
          <div>
            <p>
              <strong>Beach Rinse</strong>
            </p>
            <p>
              There&apos;s a spot at the entrance to rinse the sand off your feet after the beach,
              and a place to dry towels.
            </p>
            <video
              src="/checkin-room1-beach-rinse.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="mt-4 w-full max-w-md shadow-md"
            />
          </div>
          <div>
            <p>
              <strong>Terrace Chairs</strong>
            </p>
            <p>Please put the terrace chairs under the roof when they&apos;re not in use.</p>
          </div>
        </InfoSection>

        <InfoSection id="lights" title="Lights" titleClassName="font-sans">
          {showNightLight && (
            <div>
              <p>
                <strong>Night Light</strong>
              </p>
              <p>
                There&apos;s a light next to your bathroom, you can keep it on overnight to safely
                get to your room and bathroom. Please switch it off in the morning. All other lights
                should be off for the night.
              </p>
            </div>
          )}
          <div>
            <p>
              <strong>Terrace</strong>
            </p>
            <p>The switch is indoors on the right, marked with colorful stickers.</p>
          </div>
          <div>
            <p>
              <strong>Dining Table</strong>
            </p>
            <p>
              The light above the table is dimmable. If you&apos;re standing with your back to the
              kitchen, the button is on the right of the light.
            </p>
          </div>
          <div>
            <p>
              <strong>Paper Lamp</strong>
            </p>
            <p>Double-click the switch for warm light.</p>
          </div>
          <div>
            <p>
              <strong>Sofa</strong>
            </p>
            <p>
              The switch for the light next to the sofa is underneath it. Remove the middle cushion
              and reach under the sofa to find it.
            </p>
          </div>
        </InfoSection>

        <InfoSection id="kitchen" title="Kitchen (upstairs)" titleClassName="font-sans">
          <p>
            You have the {kitchenDryShelfPosition} shelf for dry goods, fruit, vegetables or water,
            and shelves {kitchenFridgeShelves} (from the top) in the fridge.
          </p>
          <p>Please keep the kitchen tidy:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              Don&apos;t leave dishes in the sink, give them a quick prewash and load the dishwasher
            </li>
            <li>
              If the dishwasher is full, please start it (dishwasher tablets are just below the fire
              blanket under the sink)
            </li>
            <li>Wipe the kitchen surfaces after cooking</li>
            <li>Sweep the floor if there are any crumbs, brush is under the sink</li>
          </ul>
          <Image
            src="/checkin-room1-kitchen.gif"
            alt="Kitchen, shelves and dishwasher location"
            width={426}
            height={240}
            unoptimized
            className="mt-4 w-full max-w-md shadow-md"
          />
        </InfoSection>

        <InfoSection id="dishwasher" title="Dishwasher" titleClassName="font-sans">
          <p>
            Please start the program (eco) when it&apos;s full and dirty, and unload the dishwasher
            when it&apos;s clean.
          </p>
        </InfoSection>

        <InfoSection id="safety" title="Safety" titleClassName="font-sans">
          <p>
            Under the sink on the right side you&apos;ll find a fire blanket and a first aid kit.
            Hopefully you won&apos;t need them!
          </p>
        </InfoSection>

        <InfoSection id="trash" title="Trash" titleClassName="font-sans">
          <p>
            Please segregate, left to right: paper goes in the white bin with no bag; plastic and
            packaging goes in the white bin with a purple bag; general waste goes in the grey bin
            with a black bag. Glass can be left next to the bins.
          </p>
          <p>
            If the trash is full please take it out to the trash container (~15m from the house).{" "}
            <a
              href="https://maps.app.goo.gl/tJkJW44FFG3a65qy8"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              See map
            </a>
          </p>
        </InfoSection>

        <InfoSection
          id="mosquito-protection"
          title="Mosquito Protection"
          titleClassName="font-sans"
        >
          <p>
            There&apos;s a Raid plug-in in your room. Please plug it in at night and unplug it when
            you&apos;re not using it.
          </p>
        </InfoSection>

        <InfoSection id="guests" title="Guests" titleClassName="font-sans">
          <p>
            You will be sharing the house with other guests, they have their own bedroom and
            bathroom. Please respect each other.
          </p>
          {guestsExtraLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </InfoSection>

        <div className="text-sm">
          <p>Have a great holiday, and if anything please let me know.</p>
          <p className="text-4xl font-hand mt-6">Sveta</p>
        </div>
      </main>
    </div>
  );
}
