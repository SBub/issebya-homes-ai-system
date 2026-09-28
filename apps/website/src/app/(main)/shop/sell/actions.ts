"use server";

import { addBreadcrumb, captureException, startSpan } from "@sentry/nextjs";
import { z } from "zod";
import { sendSellerSubmissionNotificationEmail } from "@/lib/resend";
import {
  isAllowedPhotoType,
  isOwnPhotoPath,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_DOWNLOAD_URL_TTL_SECONDS,
  PHOTOS_TOO_MANY_COPY,
  type PrepareResult,
  photoObjectPath,
  SELLER_ERROR_COPY,
  SELLER_SUBMISSIONS_BUCKET,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerFieldErrors,
  type SellerFields,
  type SubmitResult,
  sellerFieldsSchema,
  sellerSubmissionSchema,
} from "@/lib/shop/seller-submission";
import { createAdminClient } from "@/lib/shared/supabase";
import { type FieldError, formatZodErrors } from "@/lib/shared/validation";

// Postgres unique_violation, same convention as guest-contacts.ts.
const UNIQUE_VIOLATION = "23505";

// What `submitSellerSubmission` accepts besides the text fields. The paths are
// only shape-checked here; `isOwnPhotoPath` and the bucket listing decide
// whether they are real.
const finalizeSchema = z.object({
  submissionId: z.uuid(),
  photoPaths: z
    .array(z.string())
    .min(1)
    .max(MAX_PHOTOS)
    .refine((paths) => new Set(paths).size === paths.length),
});

function isHoneypot(issues: FieldError[]): boolean {
  return issues.some(({ field }) => field === "honeypot" || field === "fields.honeypot");
}

// First message per field. `fields.title` becomes `title`, and every
// `photos.*` issue collapses onto the one `photos` slot, naming the photo.
function toFieldErrors(issues: FieldError[]): SellerFieldErrors {
  const errors: SellerFieldErrors = {};
  for (const { field, message } of issues) {
    const [head, ...rest] = field.split(".");
    if (head === "photos") {
      errors.photos ??= rest.length ? `Photo ${Number(rest[0]) + 1}: ${message}` : message;
      continue;
    }
    const key = (head === "fields" ? rest[0] : head) as keyof SellerFields | undefined;
    if (key) errors[key] ??= message;
  }
  return errors;
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Step one of a submission: validate everything, then mint one signed upload
 * URL per photo at a path the server picks. No URL is minted unless the text
 * fields and the photo metadata all pass.
 */
export async function prepareSellerPhotoUploads(
  fields: SellerFields,
  photosMeta: { type: string; size: number }[],
): Promise<PrepareResult> {
  // A hard ceiling on URLs per request, independent of the schema.
  if (!Array.isArray(photosMeta) || photosMeta.length > MAX_PHOTOS) {
    return { kind: "invalid", errors: { photos: PHOTOS_TOO_MANY_COPY }, generalError: "" };
  }

  const parsed = sellerSubmissionSchema.safeParse({ fields, photos: photosMeta });

  if (!parsed.success) {
    const issues = formatZodErrors(parsed.error);

    // Checked before any other field, and answered with the success shape and
    // nothing minted, so a bot never learns which field gave it away.
    if (isHoneypot(issues)) {
      addBreadcrumb({ category: "shop", message: "Seller form honeypot tripped", level: "info" });
      return { kind: "done" };
    }

    return { kind: "invalid", errors: toFieldErrors(issues), generalError: "" };
  }

  const { photos } = parsed.data;

  return startSpan(
    {
      name: "shop.seller_submission.prepare",
      op: "http.server",
      attributes: {
        "http.route": "shop.prepareSellerPhotoUploads",
        "shop.photoCount": photos.length,
      },
    },
    async (): Promise<PrepareResult> => {
      const submissionId = crypto.randomUUID();
      const bucket = createAdminClient().storage.from(SELLER_SUBMISSIONS_BUCKET);

      const results = await Promise.all(
        photos.map(async ({ type }, index) => {
          const path = photoObjectPath(submissionId, index, type);
          const { data, error } = await bucket.createSignedUploadUrl(path);
          return { path, data, error };
        }),
      );

      const failed = results.find(({ error, data }) => error || !data);
      if (failed) {
        captureException(failed.error ?? new Error("No signed upload URL returned"), {
          tags: { "storage.operation": "create_signed_upload_url" },
        });
        return { kind: "invalid", errors: {}, generalError: SELLER_ERROR_COPY };
      }

      return {
        kind: "upload",
        submissionId,
        uploads: results.map(({ path, data }) => ({
          path,
          signedUrl: data?.signedUrl ?? "",
          token: data?.token ?? "",
        })),
      };
    },
  );
}

/**
 * Step two: the photos are in the bucket. Re-validate everything, confirm
 * every claimed path belongs to this submission and really exists within the
 * limits, record the row, then tell the owner. The email is best effort.
 */
export async function submitSellerSubmission(
  fields: SellerFields,
  submissionId: string,
  photoPaths: string[],
): Promise<SubmitResult> {
  const parsedFields = sellerFieldsSchema.safeParse(fields);

  if (!parsedFields.success) {
    const issues = formatZodErrors(parsedFields.error);

    if (isHoneypot(issues)) {
      addBreadcrumb({ category: "shop", message: "Seller form honeypot tripped", level: "info" });
      return { ok: true };
    }

    return { ok: false, errors: toFieldErrors(issues), generalError: "" };
  }

  const failure = (generalError: string): SubmitResult => ({ ok: false, errors: {}, generalError });

  const parsedRefs = finalizeSchema.safeParse({ submissionId, photoPaths });
  if (!parsedRefs.success) return failure(SELLER_ERROR_COPY);

  // Only paths the prepare step could have minted for this very submission.
  if (!parsedRefs.data.photoPaths.every((path) => isOwnPhotoPath(submissionId, path))) {
    addBreadcrumb({
      category: "shop",
      message: "Seller submission refused a photo path outside its own prefix",
      level: "warning",
      data: { submissionId },
    });
    return failure(SELLER_ERROR_COPY);
  }

  const data = parsedFields.data;
  const paths = [...parsedRefs.data.photoPaths].sort();

  // Only the id, the photo count and the condition go into Sentry. Never the
  // seller's name, email or phone.
  return startSpan(
    {
      name: "shop.seller_submission.submit",
      op: "http.server",
      attributes: {
        "http.route": "shop.submitSellerSubmission",
        "shop.submissionId": submissionId,
        "shop.photoCount": paths.length,
        "shop.condition": data.condition,
      },
    },
    async (): Promise<SubmitResult> => {
      const supabase = createAdminClient();
      const bucket = supabase.storage.from(SELLER_SUBMISSIONS_BUCKET);

      // Existence check against what Storage actually recorded, not what the
      // browser claims. The bucket enforces size and type on upload too.
      const { data: objects, error: listError } = await bucket.list(submissionId, { limit: 100 });

      if (listError || !objects) {
        captureException(listError ?? new Error("No listing returned"), {
          tags: { "storage.operation": "list" },
        });
        return failure(SELLER_ERROR_COPY);
      }

      const stored = new Map(objects.map((object) => [`${submissionId}/${object.name}`, object]));
      const allUploaded = paths.every((path) => {
        const metadata = stored.get(path)?.metadata;
        return (
          typeof metadata?.size === "number" &&
          metadata.size <= MAX_PHOTO_BYTES &&
          typeof metadata.mimetype === "string" &&
          isAllowedPhotoType(metadata.mimetype)
        );
      });

      if (!allUploaded) return failure(SELLER_UPLOAD_ERROR_COPY);

      const row = {
        id: submissionId,
        seller_name: data.name,
        seller_email: data.email,
        seller_phone: emptyToNull(data.phone),
        title: data.title,
        maker_or_brand: emptyToNull(data.makerOrBrand),
        materials: data.materials,
        dimensions: emptyToNull(data.dimensions),
        condition: data.condition,
        asking_price_cents: data.askingPrice,
        description: data.description,
        photo_paths: paths,
        contact_consent_at: new Date().toISOString(),
        source: "shop_sell_form",
      };

      const { error: insertError } = await supabase.from("shop_seller_submissions").insert(row);

      // Already recorded (double submit or a retry of the same finalize): the
      // row exists and the owner has had the email, so this is a success.
      if (insertError?.code === UNIQUE_VIOLATION) return { ok: true };

      if (insertError) {
        captureException(insertError, {
          tags: { "db.operation": "shop_seller_submissions_insert" },
        });
        return failure(SELLER_ERROR_COPY);
      }

      try {
        const { data: signed, error: signError } = await bucket.createSignedUrls(
          paths,
          PHOTO_DOWNLOAD_URL_TTL_SECONDS,
        );
        if (signError || !signed) throw signError ?? new Error("No signed URLs returned");
        const photoUrls = signed.map(({ signedUrl }) => signedUrl);
        if (!photoUrls.every((url): url is string => typeof url === "string")) {
          throw new Error("A photo could not be signed for download");
        }

        await sendSellerSubmissionNotificationEmail(
          {
            sellerName: row.seller_name,
            sellerEmail: row.seller_email,
            sellerPhone: row.seller_phone,
            title: row.title,
            makerOrBrand: row.maker_or_brand,
            materials: row.materials,
            dimensions: row.dimensions,
            condition: row.condition,
            askingPriceCents: row.asking_price_cents,
            description: row.description,
          },
          photoUrls,
        );
      } catch (error) {
        // The submission is saved; the owner still sees it in Studio.
        console.error("Seller submission notification failed", error);
        captureException(error, { tags: { "email.type": "seller_submission_notification" } });
      }

      return { ok: true };
    },
  );
}
