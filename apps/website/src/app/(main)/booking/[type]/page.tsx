import { Suspense } from "react";
import { ErrorBoundary } from "@sentry/nextjs";
import { redirect } from "next/navigation";
import { AirbnbReviewSlider } from "@/app/ui/AirbnbReviewSlider";
import { Callout } from "@/app/ui/Callout";
import { TabsDesktop } from "@/app/ui/TabsDesktop";
import { TabsMobile } from "@/app/ui/TabsMobile";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { room1Reviews, room2Reviews } from "@/data/airbnb-reviews";
import { BookingType, isValidBookingType } from "@/lib/shared/types/booking";
import { room1Images, room2Images } from "@/utils/images";
import { BookingEngine } from "./ui/BookingEngine";
import Gallery from "./ui/Gallery";

const bookingTabs = [
  {
    id: BookingType.room1,
    label: "room 1",
    href: `/booking/${BookingType.room1}`,
  },
  {
    id: BookingType.room2,
    label: "room 2",
    href: `/booking/${BookingType.room2}`,
  },
];

const ROOM_CONTENT: Record<string, { title: string; description: string[] }> = {
  room1: {
    title: "private room 1",
    description: [
      "The private room is located on the ground floor of a three-level house. It opens onto the front garden and has access to its own bathroom (not en suite). On the same level, there's a shared living room with a fireplace and a desk.",
      "Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic.",
      "All spaces, except for the guest bedroom and bathroom, are shared.",
    ],
  },
  room2: {
    title: "private room 2",
    description: [
      "The private room is located on the ground floor of a three-level house. It has its own en suite bathroom. On the same level, there's a shared living room with a fireplace and a desk.",
      "Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic.",
      "All spaces, except for the guest bedroom and bathroom, are shared.",
    ],
  },
};

export async function generateStaticParams() {
  return [{ type: BookingType.room1 }, { type: BookingType.room2 }];
}

export default async function BookingTypePage(props: { params: Promise<{ type: string }> }) {
  const params = await props.params;
  const type = params.type;

  // Validate and redirect if invalid
  if (!isValidBookingType(type)) {
    redirect("/booking/room1");
  }

  const roomType = type === "room1" ? BookingType.room1 : BookingType.room2;
  const { title, description } = ROOM_CONTENT[type];

  return (
    <>
      <TabsMobile tabs={bookingTabs} activeTabId={type} />

      {/* Gallery (top on mobile) */}
      <div className="order-1 md:order-2 md:w-1/2 flex flex-col items-center justify-start p-4 relative md:sticky md:top-0 md:h-screen">
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
          <h2 className="text-2xl font-hand font-bold">
            {title}
            <br />
            with shared spaces
          </h2>

          <ErrorBoundary
            fallback={
              <div className="booking-engine-error">
                <p className="text-sm text-red-600">
                  Booking is temporarily unavailable. Please reach out to us on <WhatsAppLink /> to
                  book directly.
                </p>
              </div>
            }
          >
            <Suspense fallback={null}>
              <BookingEngine roomType={roomType} />
            </Suspense>
          </ErrorBoundary>

          <p className="font-sans">cap: max 2 persons</p>

          <p className="text-sm leading-relaxed">
            📍{" "}
            <a
              href="https://maps.google.com/?q=Almoçageme,+Sintra,+Portugal"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              Almoçageme, Sintra
            </a>
          </p>

          {description.map((text, index) => (
            <p key={index} className="text-sm leading-relaxed">
              {text}
            </p>
          ))}

          <AirbnbReviewSlider
            key={roomType}
            reviews={roomType === BookingType.room1 ? room1Reviews : room2Reviews}
          />

          <div className="mt-4">
            <Callout>
              For special requests or any enquiries, please reach out to us directly on{" "}
              <WhatsAppLink />.
            </Callout>
          </div>
        </div>
      </div>
    </>
  );
}
