import { CheckinTemplate } from "../../_components/CheckinTemplate";

export default function Room1CheckinPage() {
  return (
    <CheckinTemplate
      hash="daa85bb2f760"
      guestName="Hendrik"
      roomTourGifSrc="/checkin-room1-room-tour.gif"
      kitchenDryShelfPosition="top"
      kitchenFridgeShelves="3 and 4"
      showNightLight
      guestsExtraLines={["Guest rotation: 24.07 & 27.07.", "I will be back on the night of 28.07."]}
    />
  );
}
