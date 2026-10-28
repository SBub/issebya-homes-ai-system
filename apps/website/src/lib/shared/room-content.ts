// Per-room copy for the booking page and its metadata, also read by the e2e smoke spec.
export const ROOM_CONTENT: Record<
  string,
  { title: string; description: string[]; airbnbUrl: string }
> = {
  room1: {
    title: "Private room 1",
    description: [
      "The private room is located on the ground floor of a three-level house. It opens onto the front garden and has access to its own bathroom (not en suite). On the same level, there's a shared living room with a fireplace and a desk. Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic. All spaces, except for the guest bedroom and bathroom, are shared.",
    ],
    airbnbUrl: "https://www.airbnb.com/rooms/1424633715489915166",
  },
  room2: {
    title: "Private room 2",
    description: [
      "The private room is located on the ground floor of a three-level house. It has its own en suite bathroom. On the same level, there's a shared living room with a fireplace and a desk. Upstairs, there is an open kitchen and a second living area. The kitchen is fully equipped, and the terrace just beyond it offers distant views of the Atlantic. All spaces, except for the guest bedroom and bathroom, are shared.",
    ],
    airbnbUrl: "https://www.airbnb.com/rooms/1507883205063503481",
  },
};

const MAX_DESCRIPTION_LENGTH = 160;

// The leading whole sentences of `text` that fit in a meta description. Only
// cuts mid-sentence when the first sentence alone is already too long.
export function roomMetaDescription(text: string): string {
  const sentences = text.split(/(?<=\.)\s+/);
  let result = "";
  for (const sentence of sentences) {
    const next = result ? `${result} ${sentence}` : sentence;
    if (next.length > MAX_DESCRIPTION_LENGTH) break;
    result = next;
  }
  if (result) return result;

  const cut = sentences[0].slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}
