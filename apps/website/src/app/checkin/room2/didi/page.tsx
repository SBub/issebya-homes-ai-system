import { CheckinTemplate } from "../../_components/CheckinTemplate";

export default function Room2DidiCheckinPage() {
  return (
    <CheckinTemplate
      hash="fb0e38ef806f"
      guestName="Didi"
      roomTourGifSrc="/checkin-room2-room-tour.gif"
      kitchenDryShelfPosition="bottom"
      kitchenFridgeShelves="1 and 2"
      showNightLight={false}
      guestsExtraLines={["I'll be arriving at the house on the night of 28.07."]}
    />
  );
}
