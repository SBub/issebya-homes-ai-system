import type { ReactNode } from "react";
import type { Tab } from "@/app/ui/TabsDesktop";
import { TabsDesktop } from "@/app/ui/TabsDesktop";
import { TabsMobile } from "@/app/ui/TabsMobile";
import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { ROOM_CONTENT } from "@/lib/shared/room-content";
import type { BookingType } from "@/lib/shared/types/booking";
import { room1Images, room2Images } from "@/utils/images";
import Gallery from "./Gallery";

type RoomPageProps = {
  type: BookingType;
  tabs: Tab[];
  // The date picker: the nightly booking engine or the lock-in week grid.
  engine: ReactNode;
};

/**
 * A room's page as both `/booking/[type]` and `/lock-in/[type]` render it:
 * tabs, gallery, the engine slot, capacity, location, description, reviews
 * and contact. The routes differ only in their tabs and engine.
 */
export function RoomPage({ type, tabs, engine }: RoomPageProps) {
  const { description, airbnbUrl } = ROOM_CONTENT[type];

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-shop-card font-sans">
      <TabsMobile tabs={tabs} activeTabId={type} />

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
        <TabsDesktop tabs={tabs} activeTabId={type} />
        <div className="space-y-6">
          {engine}

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
