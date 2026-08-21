import { AirbnbReviewSlider } from "@/app/ui/AirbnbReviewSlider";
import { Callout } from "@/app/ui/Callout";
import { room1Reviews, room2Reviews } from "@/data/airbnb-reviews";
import { BookingType } from "@/lib/shared/types/booking";
import { BookingEngine } from "./BookingEngine";

type BookingInfoBlockProps = {
  type: "room" | "event";
  title: string;
  subtitle?: string;
  capacity: string;
  description: string[];
  note?: React.ReactNode;
  roomType?: BookingType.room1 | BookingType.room2;
};

export default function BookingInfoBlock({
  type,
  title,
  subtitle,
  capacity,
  description,
  note,
  roomType,
}: BookingInfoBlockProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-hand font-bold">
        {title}
        {subtitle && (
          <>
            <br />
            {subtitle}
          </>
        )}
      </h2>

      {/* Show BookingEngine for rooms, AirbnbButton for event space */}
      {type === "room" && roomType ? <BookingEngine roomType={roomType} /> : null}

      {type === "event" && <p className="text-xl font-hand font-bold mt-4">40€ / hour (min 4h)</p>}
      <p className="font-sans">{capacity}</p>

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

      {type === "room" && roomType && (
        <AirbnbReviewSlider
          key={roomType}
          reviews={roomType === BookingType.room1 ? room1Reviews : room2Reviews}
        />
      )}

      {note && (
        <div className="mt-4">
          <Callout>{note}</Callout>
        </div>
      )}
    </div>
  );
}
