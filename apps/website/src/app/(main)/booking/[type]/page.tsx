import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TabsDesktop } from "@/app/ui/TabsDesktop";
import { TabsMobile } from "@/app/ui/TabsMobile";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { ROOM_CONTENT, roomMetaDescription } from "@/lib/shared/room-content";
import { BookingType, isValidBookingType } from "@/lib/shared/types/booking";
import { SITE_URL } from "@/lib/site";
import { room1Images, room2Images } from "@/utils/images";
import Gallery from "./ui/Gallery";
import { GuardedBookingEngine } from "./ui/GuardedBookingEngine";

const bookingTabs = [
  {
    id: BookingType.room1,
    label: "Room 1",
    href: `/booking/${BookingType.room1}`,
  },
  {
    id: BookingType.room2,
    label: "Room 2",
    href: `/booking/${BookingType.room2}`,
  },
];

export async function generateStaticParams() {
  return [{ type: BookingType.room1 }, { type: BookingType.room2 }];
}

// Reads `params` only, never searchParams, cookies() or headers(), so the
// card is per room rather than per link and both rooms keep prerendering.
export async function generateMetadata(props: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type: requested } = await props.params;
  // An unknown type is a redirect, not a build failure: the page itself
  // redirects to /booking/room1. Returning room1's card here keeps
  // generateMetadata from throwing first, and matches where the guest lands.
  const type = isValidBookingType(requested) ? requested : BookingType.room1;
  const { title: roomTitle, description: paragraphs } = ROOM_CONTENT[type];
  const title = `Book ${roomTitle} - issebya.homes`;
  const description = roomMetaDescription(paragraphs[0]);
  const url = `${SITE_URL}/booking/${type}`;
  // A JPEG with declared dimensions: WhatsApp's preview fetcher skips WebP
  // and uses width/height to render without a second fetch.
  const image = {
    url: `/og/booking-${type}.jpg`,
    width: 1200,
    height: 630,
    type: "image/jpeg",
    alt: `${roomTitle} at issebya.homes`,
  };

  // Metadata merges shallowly: these openGraph/twitter objects replace the
  // root layout's wholesale, so each carries its own title and description.
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function BookingTypePage(props: { params: Promise<{ type: string }> }) {
  const params = await props.params;
  const type = params.type;

  // Validate and redirect if invalid
  if (!isValidBookingType(type)) {
    redirect("/booking/room1");
  }

  const roomType = type === "room1" ? BookingType.room1 : BookingType.room2;
  const { description, airbnbUrl } = ROOM_CONTENT[type];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-shop-card font-sans">
      <TabsMobile tabs={bookingTabs} activeTabId={type} />

      {/* Gallery (top on mobile) */}
      <div className="order-1 md:order-2 md:w-1/2 flex flex-col items-center justify-start p-4 md:pt-[88px] relative md:sticky md:top-0 md:h-screen">
        <Gallery
          key={type} // Force remount when type changes
          images={type === "room1" ? room1Images : room2Images}
          roomType={type}
        />
      </div>

      {/* Room Content */}
      <div className="order-2 md:order-1 md:w-1/2 p-4 md:p-12 space-y-6">
        <TabsDesktop tabs={bookingTabs} activeTabId={type} />
        <div className="space-y-6">
          <GuardedBookingEngine roomType={roomType} />

          <p className="text-secondary text-xs">
            Capacity: max 2 persons. Once a reservation is made, we are unable to provide a refund.
          </p>

          <p className="text-secondary">
            <a
              href="https://maps.google.com/?q=Almoçageme,+Sintra,+Portugal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary-link"
            >
              Almoçageme, Sintra
            </a>
          </p>

          {description.map((text, index) => (
            <p key={index} className="text-secondary">
              {text}
            </p>
          ))}

          <p className="text-secondary">
            <a
              href={airbnbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary-link"
            >
              Read public reviews on Airbnb
            </a>
          </p>

          <p className="text-secondary">
            For special requests or any enquiries, please reach out to us directly on{" "}
            <WhatsAppLink />.
          </p>
        </div>
      </div>
    </div>
  );
}
