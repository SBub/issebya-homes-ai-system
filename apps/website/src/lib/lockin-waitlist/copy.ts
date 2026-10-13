/**
 * Every visitor-facing string of the lock-in waitlist at `/lockin-waitlist`:
 * page sections, form labels and option lists, the consent sentence, the
 * welcome email and the unsubscribe pages.
 *
 * Imports nothing, so it runs in the vitest node pool and the page, the forms,
 * the action and the email all read one source. Rules for every string here:
 * "lock-in" lowercase ("Lock-in" only at the start of a sentence), the brand
 * always "issebya.homes", and never an em dash.
 */

// --- Page metadata ---

export const LOCKIN_META_TITLE = "Lock-in waitlist | issebya.homes";

// --- 1. Hero ---

export const LOCKIN_HERO_HEADLINE = "This autumn, I take the wheel of my life.";

export const LOCKIN_HERO_SUBLINE =
  "Stop running in circles. 7 days away from home to move towards what you've always wanted.";

export const LOCKIN_OG_IMAGE_ALT = "The terrace at issebya.homes, where lock-ins happen";

// --- 2. What a lock-in is ---

export const LOCKIN_WHAT_IS_HEADING = "What a lock-in is";

// Also the body of the welcome email.
export const LOCKIN_WHAT_IS = [
  "A lock-in is 7 days away from home, no addictions, full focus on the one area of your life that hurts most.",
  "Not a holiday. Not a retreat with a schedule. Time you give yourself to finally do what you keep postponing.",
] as const;

// --- 3. Why not at home ---

export const LOCKIN_WHY_AWAY_HEADING = "Why not at home";

export const LOCKIN_WHY_AWAY = [
  "At home your old patterns are waiting for you: the same walls, the same habits, the same distractions.",
  "A new place makes it easier to become someone new.",
] as const;

// --- 4. What happens during a lock-in ---

export const LOCKIN_HAPPENS_HEADING = "What happens during a lock-in";

// `icon` picks the inline SVG the page draws beside each point.
export const LOCKIN_HAPPENS = [
  { icon: "room", title: "Your own quiet room", text: "" },
  { icon: "phone", title: "No addictions", text: "phone, scrolling, noise set aside" },
  { icon: "focus", title: "One focus", text: "the area of your life you choose" },
  { icon: "plan", title: "Time and space to decide, plan and start", text: "" },
] as const;

// --- 5. The space ---

export const LOCKIN_SPACE_HEADING = "The space";

export const LOCKIN_GALLERY = [
  { src: "/terrace.webp", alt: "The sunny terrace at issebya.homes" },
  { src: "/bedroom.webp", alt: "A quiet, light bedroom at issebya.homes" },
  { src: "/living_room.webp", alt: "The calm living room at issebya.homes" },
  { src: "/kitchen_living_room.webp", alt: "The open kitchen and living room at issebya.homes" },
  { src: "/frontyard.webp", alt: "The front yard of issebya.homes in the natural park" },
] as const;

// --- 6. Who's behind it ---

export const LOCKIN_HOST_HEADING = "Who's behind it";

// PLACEHOLDER: the host text and photo are not provided yet. This is the one
// place the owner swaps them in.
export const LOCKIN_HOST_TEXT =
  "[PLACEHOLDER: host text, 1 to 2 first-person sentences. Replace in copy.ts]";

export const LOCKIN_HOST_PHOTO = {
  src: "/living_room_puff.webp",
  alt: "A cosy corner of the living room at issebya.homes",
} as const;

// --- 7. Full form ---

export const LOCKIN_FORM_INTRO = "I decided to take care of myself. Keep me posted.";

export const LOCKIN_FORM_REASON = "First lock-in dates open to the waitlist first.";

export const LOCKIN_EMAIL_LABEL = "Email";

export const LOCKIN_NAME_LABEL = "Name (optional)";

export const LOCKIN_LIFE_AREA_LABEL = "Which area of your life would you work on?";

export const LOCKIN_DURATION_LABEL = "How long would you lock in?";

export const LOCKIN_MONTHS_LABEL = "When?";

export const LOCKIN_SUBMIT_LABEL = "Join the waitlist";

export const LOCKIN_PENDING_LABEL = "Joining...";

// Values are the slugs stored in `lockin_waitlist`, matching the migration's
// CHECK constraints exactly. Labels can change freely; values cannot.
export const LOCKIN_LIFE_AREAS = [
  { value: "work_business", label: "Work / business" },
  { value: "relationships", label: "Relationships" },
  { value: "health", label: "Health" },
  { value: "creative_project", label: "Creative project" },
  { value: "other", label: "Other" },
] as const;

export const LOCKIN_DURATIONS = [
  { value: "weekend", label: "Weekend" },
  { value: "3_days", label: "3 days" },
  { value: "7_days", label: "7 days" },
] as const;

export const LOCKIN_MONTHS = [
  { value: "november", label: "November" },
  { value: "december", label: "December" },
  { value: "january", label: "January" },
  { value: "later", label: "Later" },
] as const;

// The consent sentence shown next to the checkbox. The Server Action stores
// this server-side constant as `opt_in_copy`, never a value from the form, so
// the recorded wording is always the wording the visitor actually saw.
export const LOCKIN_OPT_IN_COPY = "I agree to receive emails about lock-in. Unsubscribe anytime.";

export const LOCKIN_PRIVACY_LINK_LABEL = "Privacy policy";

export const LOCKIN_OPT_IN_REQUIRED = "Please tick the box so we can email you about lock-in.";

export const LOCKIN_EMAIL_INVALID = "Please enter a valid email address";

export const LOCKIN_ERROR_COPY = "Sorry, that did not save. Please try again in a moment.";

// --- 8. Thank-you state ---

export const LOCKIN_THANKS_HEADLINE = "You're in.";

export const LOCKIN_THANKS_TEXT = "You'll be the first to know when lock-in dates open.";

export const LOCKIN_FOLLOWUP_LABEL = "What made you sign up?";

export const LOCKIN_FOLLOWUP_SUBMIT_LABEL = "Send";

export const LOCKIN_FOLLOWUP_SAVED = "Thank you for telling me.";

export const LOCKIN_FOLLOWUP_TOO_LONG = "Please keep it under 1000 characters.";

export const LOCKIN_FOLLOWUP_EMPTY = "Please write a few words, or just leave it.";

// --- Welcome email ---

// An en dash, matching the booking and wishlist email subjects. Never an em dash.
export const LOCKIN_EMAIL_SUBJECT = "You're on the lock-in waitlist – issebya.homes";

const LOCKIN_EMAIL_CONFIRMATION = "You're on the lock-in waitlist.";

// The email's last line. The builder appends the visitor's unsubscribe link.
const LOCKIN_UNSUBSCRIBE_LINE = "If you'd rather not receive these emails, unsubscribe here:";

// The welcome email body. The URL is passed in rather than built here so this
// module stays free of site config.
export function lockinWelcomeEmailText({ unsubscribeUrl }: { unsubscribeUrl: string }): string {
  return [
    LOCKIN_EMAIL_CONFIRMATION,
    "",
    LOCKIN_WHAT_IS[0],
    "",
    LOCKIN_WHAT_IS[1],
    "",
    LOCKIN_THANKS_TEXT,
    "",
    `${LOCKIN_UNSUBSCRIBE_LINE} ${unsubscribeUrl}`,
  ].join("\n");
}

// --- Unsubscribe pages ---

export const LOCKIN_UNSUBSCRIBED_COPY =
  "You're unsubscribed. You won't get any more emails about lock-in.";

export const LOCKIN_ALREADY_UNSUBSCRIBED_COPY = "You're already unsubscribed.";

export const LOCKIN_UNSUBSCRIBE_INVALID_COPY = "This link isn't valid.";
