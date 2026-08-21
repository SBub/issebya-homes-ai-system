import { WhatsAppLink } from "@/app/ui/WhatsAppLink";
import { BookingType } from "@/lib/shared/types/booking";
import BookingInfoBlock from "./BookingInfoBlock";

type BookingContentProps = {
  type: BookingType;
};

export default function BookingContent({ type }: BookingContentProps) {
  return (
    <>
      {type === "room1" ? (
        <BookingInfoBlock
          type="room"
          title="private room 1"
          subtitle="with shared spaces"
          capacity="cap: max 2 persons"
          roomType={BookingType.room1}
          description={[
            "The private room is located on the ground floor of a three-level house. It opens onto the front garden and has access to its own bathroom (not en suite). On the same level, there's a shared living room with a fireplace and a desk.",
            "Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic.",
            "All spaces, except for the guest bedroom and bathroom, are shared.",
          ]}
          note={
            <>
              For special requests or any enquiries, please reach out to us directly on{" "}
              <WhatsAppLink source="Booking" />.
            </>
          }
        />
      ) : type === "room2" ? (
        <BookingInfoBlock
          type="room"
          title="private room 2"
          subtitle="with shared spaces"
          capacity="cap: max 2 persons"
          roomType={BookingType.room2}
          description={[
            "The private room is located on the ground floor of a three-level house. It has its own en suite bathroom. On the same level, there's a shared living room with a fireplace and a desk.",
            "Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic.",
            "All spaces, except for the guest bedroom and bathroom, are shared.",
          ]}
          note={
            <>
              For special requests or any enquiries, please reach out to us directly on{" "}
              <WhatsAppLink source="Booking" />.
            </>
          }
        />
      ) : (
        <BookingInfoBlock
          type="event"
          title="a house for"
          subtitle="intimate gatherings"
          capacity="cap: 8 guests (recommended)"
          description={[
            "The house is designed for small, thoughtful gatherings. A place to cook, share a meal, or spend time together — held in a quiet, layered space by the Atlantic.",
            "There's a dining table for 8 in the open kitchen, with a terrace just beyond that seats 6 — perfect for slow lunches with distant ocean views. On the ground floor, the front garden offers outdoor space with a firepit, and the living room with a fireplace becomes a cozy spot to gather or linger between courses.",
            "The dining area and bar setup can flow between the kitchen, terrace, living room, and garden — shaped to match the rhythm of your gathering.",
            "A space for dinners, lunches, birthdays, creative meetings, or quiet celebrations",
          ]}
          note={
            <>
              For special requests or any enquiries, please reach out to us directly on{" "}
              <WhatsAppLink source="Booking" />.
            </>
          }
        />
      )}
    </>
  );
}
