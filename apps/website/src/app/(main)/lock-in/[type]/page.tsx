import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoomPage } from "@/app/(main)/booking/[type]/ui/RoomPage";
import { ROOM_CONTENT, roomMetaDescription } from "@/lib/shared/room-content";
import { BookingType, isValidBookingType } from "@/lib/shared/types/booking";
import { SITE_URL } from "@/lib/site";
import { GuardedLockInEngine } from "./ui/GuardedLockInEngine";

const lockInTabs = [
  {
    id: BookingType.room1,
    label: "Room 1",
    href: `/lock-in/${BookingType.room1}`,
  },
  {
    id: BookingType.room2,
    label: "Room 2",
    href: `/lock-in/${BookingType.room2}`,
  },
];

export async function generateStaticParams() {
  return [{ type: BookingType.room1 }, { type: BookingType.room2 }];
}

// Reads `params` only, like the booking page's, so the static shell of both
// rooms still prerenders; only the week grid waits for the request.
export async function generateMetadata(props: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type: requested } = await props.params;
  const type = isValidBookingType(requested) ? requested : BookingType.room1;
  const { title: roomTitle, description: paragraphs } = ROOM_CONTENT[type];
  const title = `Lock-in week, ${roomTitle} - issebya.homes`;
  const description = roomMetaDescription(paragraphs[0]);
  const url = `${SITE_URL}/lock-in/${type}`;
  const image = {
    url: `/og/booking-${type}.jpg`,
    width: 1200,
    height: 630,
    type: "image/jpeg",
    alt: `${roomTitle} at issebya.homes`,
  };

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function LockInTypePage(props: { params: Promise<{ type: string }> }) {
  const { type } = await props.params;

  if (!isValidBookingType(type)) {
    redirect("/lock-in/room1");
  }

  const roomType = type === "room1" ? BookingType.room1 : BookingType.room2;

  return (
    <RoomPage type={type} tabs={lockInTabs} engine={<GuardedLockInEngine roomType={roomType} />} />
  );
}
