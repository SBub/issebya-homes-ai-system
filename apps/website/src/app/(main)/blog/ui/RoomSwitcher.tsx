"use client";

import { type ReactNode, useState } from "react";
import posthog from "posthog-js";
import { tabStateClasses } from "@/app/ui/tab-styles";

interface RoomSwitcherProps {
  room1: ReactNode;
  room2: ReactNode;
}

const ROOMS = [
  { id: "room1", label: "room 1" },
  { id: "room2", label: "room 2" },
] as const;

type RoomId = (typeof ROOMS)[number]["id"];

/**
 * Toggles which of the two prerendered booking engines is on screen.
 *
 * Both engines arrive as `ReactNode` props from the Server Component above, so
 * both rooms' availability is already in this page's static payload. Switching
 * is therefore pure client state and issues no request.
 *
 * State lives here rather than in the URL on purpose: putting it in the URL
 * would mean reading `searchParams` in the post route, which opts that route
 * out of the static shell.
 *
 * Only the active room is rendered. Keeping the inactive one mounted but
 * hidden would put a second booking form in the DOM, duplicating every
 * `aria-label` on the page and leaving locators ambiguous for tests and screen
 * readers alike. The cost is that unmounting drops any date selection, which
 * is also the behaviour we want: blocked dates differ per room, so carrying a
 * selection across could show the guest a range that is not bookable.
 */
export function RoomSwitcher({ room1, room2 }: RoomSwitcherProps) {
  const [activeRoom, setActiveRoom] = useState<RoomId>("room1");

  const panels: Record<RoomId, ReactNode> = { room1, room2 };

  return (
    <div>
      <div role="tablist" aria-label="Choose a room" className="flex border-b">
        {ROOMS.map(({ id, label }, index) => {
          const isActive = id === activeRoom;
          const isLast = index === ROOMS.length - 1;

          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`blog-room-tab-${id}`}
              aria-selected={isActive}
              aria-controls="blog-room-panel"
              onClick={() => {
                if (isActive) return;
                posthog.capture("room_tab_clicked", { room_type: id });
                setActiveRoom(id);
              }}
              className={`w-1/2 px-3 py-1.5 text-sm text-center sm:w-auto sm:px-6 sm:py-2 sm:text-base ${tabStateClasses(isActive)} ${!isLast ? "border-r border-black" : ""}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        id="blog-room-panel"
        role="tabpanel"
        aria-labelledby={`blog-room-tab-${activeRoom}`}
        className="pt-4"
      >
        {panels[activeRoom]}
      </div>
    </div>
  );
}
