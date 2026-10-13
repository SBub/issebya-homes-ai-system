import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ROOM_CONTENT, roomMetaDescription } from "@/lib/shared/room-content";
import { BookingType, isValidBookingType } from "@/lib/shared/types/booking";
import { SITE_URL } from "@/lib/site";
import { GuardedBookingEngine } from "./ui/GuardedBookingEngine";
import { RoomPage } from "./ui/RoomPage";

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

  return (
    <RoomPage
      type={type}
      tabs={bookingTabs}
      engine={<GuardedBookingEngine roomType={roomType} />}
    />
  );
}
