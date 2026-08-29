import { redirect } from "next/navigation";
import { TabsDesktop } from "@/app/ui/TabsDesktop";
import { TabsMobile } from "@/app/ui/TabsMobile";
import { BookingType, isValidBookingType } from "@/lib/shared/types/booking";
import { eventImages, room1Images, room2Images } from "@/utils/images";
import BookingContent from "./ui/BookingContent";
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
  // hidden: event space tab not shown until ready
  // { id: BookingType.event, label: 'event space', href: `/booking/${BookingType.event}` },
];

export async function generateStaticParams() {
  return [{ type: BookingType.room1 }, { type: BookingType.room2 }, { type: BookingType.event }];
}

export default async function BookingTypePage(props: { params: Promise<{ type: string }> }) {
  const params = await props.params;
  const type = params.type;

  // Validate and redirect if invalid
  if (!isValidBookingType(type)) {
    redirect("/booking/room1");
  }

  return (
    <>
      <TabsMobile tabs={bookingTabs} activeTabId={type} />

      {/* Gallery (top on mobile) */}
      <div className="order-1 md:order-2 md:w-1/2 flex flex-col items-center justify-start p-4 relative md:sticky md:top-0 md:h-screen">
        <Gallery
          key={type} // Force remount when type changes
          images={type === "room1" ? room1Images : type === "room2" ? room2Images : eventImages}
          roomType={type}
        />
      </div>

      {/* Room Content */}
      <div className="order-2 md:order-1 md:w-1/2 p-4 md:p-12 space-y-6">
        <TabsDesktop tabs={bookingTabs} activeTabId={type} />
        <BookingContent type={type} />
      </div>
    </>
  );
}
