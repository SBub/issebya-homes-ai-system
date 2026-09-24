/**
 * Limits, copy and validation for the seller submission form on `/shop/sell`.
 *
 * Imports only `zod` and the shared email schema, so it runs in the vitest
 * node pool and is shared by the client form and the Server Actions. It lives
 * outside `actions.ts` because a "use server" file may only export async
 * functions, and a schema or a string constant is a value export.
 */
import { z } from "zod";
import { emailSchema } from "@/lib/shared/schemas/email";

// Private Storage bucket holding the photos. Object paths inside it are
// `<submissionId>/<index>.<ext>`, never prefixed with the bucket name.
export const SELLER_SUBMISSIONS_BUCKET = "seller-submissions";

const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 6;
// Same cap as the bucket's own `file_size_limit`.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type PhotoType = (typeof ALLOWED_PHOTO_TYPES)[number];

const PHOTO_EXTENSION: Record<PhotoType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const SELLER_CONDITIONS = ["new", "like_new", "used", "vintage"] as const;
export type SellerCondition = (typeof SELLER_CONDITIONS)[number];

export const SELLER_CONDITION_LABELS: Record<SellerCondition, string> = {
  new: "New",
  like_new: "Like new",
  used: "Used",
  vintage: "Vintage",
};

// How long the photo links in the owner's email keep working.
export const PHOTO_DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

// --- Copy ---

export const SELL_LINK_COPY = "Have a piece that belongs in the house?";
export const SELL_LINK_LABEL = "Offer it here.";

export const SELLER_CONTACT_CONSENT_COPY = "You can contact me about this piece.";

export function sellerSuccessCopy(email: string): string {
  return `Thank you. Sveta will look at your piece and get back to you at ${email}.`;
}

export const SELLER_ERROR_COPY = "Sorry, that did not send. Please try again in a moment.";

export const SELLER_UPLOAD_ERROR_COPY =
  "One of your photos did not upload. Please check your connection and try again.";

export const PHOTOS_NONE_COPY = "Add at least one photo of the piece.";
export const PHOTOS_TOO_MANY_COPY = `You can add up to ${MAX_PHOTOS} photos.`;
export const PHOTO_TOO_LARGE_COPY = "too large (max 5 MB)";
export const PHOTO_WRONG_TYPE_COPY = "JPEG, PNG or WebP only";
const PHOTO_EMPTY_COPY = "this file is empty";

const PRICE_COPY = "Enter a price in euros, e.g. 120 or 120.50";

// --- Price ---

// Whole euros, optionally a `.` or `,` and one or two cent digits. Nothing
// else: no currency sign, no sign, no exponent, no thousands separator. Two
// flat patterns rather than one with an optional group, which would nest a
// quantifier.
const WHOLE_EUROS = /^\d{1,7}$/;
const EUROS_AND_CENTS = /^(\d{1,7})[.,](\d{1,2})$/;

/**
 * The one place a price the seller typed becomes integer cents. Splits on the
 * separator and pads the fraction instead of multiplying a float, so
 * `"120.05"` is exactly 12005. Returns null for anything it cannot read.
 */
export function eurosToCents(input: string): number | null {
  const value = input.trim();
  if (WHOLE_EUROS.test(value)) return Number(value) * 100;

  const match = EUROS_AND_CENTS.exec(value);
  if (!match) return null;

  const [, euros, cents] = match;
  return Number(euros) * 100 + Number(cents.padEnd(2, "0"));
}

/** Integer cents to a display price: `12050` is `€120.50`. */
export function formatCents(cents: number): string {
  return `€${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// --- Schemas ---

function optionalText(max: number, message: string) {
  return z.string().trim().max(max, message);
}

export const sellerFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Please enter your name")
    .max(80, "Please keep your name under 80 characters"),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .refine((phone) => phone === "" || (phone.length >= 5 && phone.length <= 30), {
      message: "Please enter a phone number between 5 and 30 characters, or leave it empty",
    }),
  title: z
    .string()
    .trim()
    .min(1, "Please give the piece a title")
    .max(80, "Please keep the title under 80 characters"),
  makerOrBrand: optionalText(40, "Please keep the maker or brand under 40 characters"),
  materials: z
    .string()
    .trim()
    .min(1, "Please tell us what it is made of")
    .max(200, "Please keep the materials under 200 characters"),
  dimensions: optionalText(120, "Please keep the dimensions under 120 characters"),
  condition: z.enum(SELLER_CONDITIONS, { error: "Please choose the condition" }),
  askingPrice: z.string().transform((value, ctx) => {
    const cents = eurosToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: PRICE_COPY });
      return z.NEVER;
    }
    return cents;
  }),
  description: z
    .string()
    .trim()
    .min(20, "Please write at least 20 characters about the piece")
    .max(2000, "Please keep the description under 2000 characters"),
  // Consent is a hard gate: only an affirmative tick passes.
  contactConsent: z.literal(true, { error: "Please confirm we can contact you" }),
  honeypot: z.string().max(0),
});

const photoMetaSchema = z.object({
  type: z.enum(ALLOWED_PHOTO_TYPES, { error: PHOTO_WRONG_TYPE_COPY }),
  size: z.number().int().positive(PHOTO_EMPTY_COPY).max(MAX_PHOTO_BYTES, PHOTO_TOO_LARGE_COPY),
});

const photosMetaSchema = z
  .array(photoMetaSchema)
  .min(MIN_PHOTOS, PHOTOS_NONE_COPY)
  .max(MAX_PHOTOS, PHOTOS_TOO_MANY_COPY);

export const sellerSubmissionSchema = z.object({
  fields: sellerFieldsSchema,
  photos: photosMetaSchema,
});

/**
 * The per-file check the form runs the moment a file is chosen, so an
 * oversize or non-image file is rejected before any upload. Same rules as the
 * server's `photoMetaSchema`, because it is that schema.
 */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  const result = photoMetaSchema.safeParse({ type: file.type, size: file.size });
  return result.success ? null : result.error.issues[0].message;
}

// --- Paths ---

export function isAllowedPhotoType(type: string): type is PhotoType {
  return (ALLOWED_PHOTO_TYPES as readonly string[]).includes(type);
}

/** The server picks every object path. The bucket name is never part of it. */
export function photoObjectPath(submissionId: string, index: number, type: PhotoType): string {
  return `${submissionId}/${index}.${PHOTO_EXTENSION[type]}`;
}

const OWN_PHOTO_PATH =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-5]\.(?:jpg|png|webp)$/;

/**
 * True only for a path this submission's `prepare` step could have minted:
 * exactly `<submissionId>/<0-5>.<jpg|png|webp>`. Anything else (another id, a
 * bucket prefix, `..`, a leading `/`, a seventh index) is refused.
 */
export function isOwnPhotoPath(submissionId: string, path: string): boolean {
  const match = OWN_PHOTO_PATH.exec(path);
  return match !== null && match[1] === submissionId;
}

// --- Form state ---

// The raw input as the browser sends it. Every Server Action argument is
// untrusted, so both actions re-validate it with `sellerFieldsSchema`.
export type SellerFields = {
  name: string;
  email: string;
  phone: string;
  title: string;
  makerOrBrand: string;
  materials: string;
  dimensions: string;
  condition: string;
  askingPrice: string;
  description: string;
  contactConsent: boolean;
  honeypot: string;
};

export type SellerFieldErrors = Partial<Record<keyof SellerFields | "photos", string>>;

type PhotoUpload = { path: string; signedUrl: string; token: string };

export type PrepareResult =
  | { kind: "invalid"; errors: SellerFieldErrors; generalError: string }
  | { kind: "upload"; submissionId: string; uploads: PhotoUpload[] }
  // A tripped honeypot: the bot sees success, nothing was minted.
  | { kind: "done" };

export type SubmitResult =
  { ok: true } | { ok: false; errors: SellerFieldErrors; generalError: string };

// React resets an uncontrolled <form> as soon as an `action` submission starts.
// `values` echoes back only the seller's own input so the inputs can be
// re-keyed and re-seeded, the same reason as `BookingFormState.values`.
export type SellerFormState = {
  attempt: number;
  ok: boolean;
  errors: SellerFieldErrors;
  generalError: string;
  values: SellerFields;
};

export const initialSellerFormState: SellerFormState = {
  attempt: 0,
  ok: false,
  errors: {},
  generalError: "",
  values: {
    name: "",
    email: "",
    phone: "",
    title: "",
    makerOrBrand: "",
    materials: "",
    dimensions: "",
    condition: "",
    askingPrice: "",
    description: "",
    contactConsent: false,
    honeypot: "",
  },
};

// One mapping from the form's fields to `SellerFields`, shared by the form and
// its tests. The honeypot input is named `website` in the DOM: bots fill it,
// humans never see it.
export function sellerFieldsFromFormData(formData: FormData): SellerFields {
  const text = (key: string) => String(formData.get(key) ?? "");
  return {
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    makerOrBrand: text("makerOrBrand"),
    materials: text("materials"),
    dimensions: text("dimensions"),
    condition: text("condition"),
    askingPrice: text("askingPrice"),
    description: text("description"),
    contactConsent: formData.get("contactConsent") === "on",
    honeypot: text("website"),
  };
}
