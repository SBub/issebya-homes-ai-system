"use client";

import posthog from "posthog-js";
import { type ChangeEvent, type ReactNode, useActionState, useRef, useState } from "react";
import {
  ALLOWED_PHOTO_TYPES,
  checkPhotoFile,
  initialSellerFormState,
  MAX_PHOTOS,
  PHOTOS_NONE_COPY,
  PHOTOS_TOO_MANY_COPY,
  SELLER_CONDITION_LABELS,
  SELLER_CONDITIONS,
  SELLER_CONTACT_CONSENT_COPY,
  SELLER_ERROR_COPY,
  SELLER_UPLOAD_ERROR_COPY,
  type SellerFieldErrors,
  type SellerFormState,
  sellerFieldsFromFormData,
  sellerSuccessCopy,
} from "@/lib/shop/seller-submission";
import { prepareSellerPhotoUploads, submitSellerSubmission } from "../actions";
import { uploadPhoto } from "./upload-photo";

// A chosen photo. Files live in state, not in the <form>: React resets the
// form (file inputs included) when an action starts, and the files must never
// reach a Server Action anyway. They go straight to Storage.
type ChosenPhoto = {
  id: number;
  file: File;
  error: string | null;
  // Set only while (or after) this photo uploads.
  progress: number | null;
};

const inputClass = (error: string | undefined) =>
  `border px-3 py-2 text-sm bg-transparent w-full ${error ? "border-red-500" : "border-current"}`;

type FieldProps = {
  name: keyof SellerFieldErrors;
  label: string;
  error: string | undefined;
  helper?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    className: string;
  }) => ReactNode;
};

// Label, control and error for one field, wired together with stable ids.
function Field({ name, label, error, helper, children }: FieldProps) {
  const id = `seller-${name}`;
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const describedBy = [helper ? helperId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={`seller-${name}-label text-sm`}>
        {label}
      </label>
      {children({
        id,
        name,
        "aria-invalid": !!error,
        "aria-describedby": describedBy || undefined,
        className: inputClass(error),
      })}
      {helper && (
        <span id={helperId} className="text-xs">
          {helper}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-red-500 text-xs">
          {error}
        </span>
      )}
    </div>
  );
}

export function SellerForm() {
  const [photos, setPhotos] = useState<ChosenPhoto[]>([]);
  const [photoNotice, setPhotoNotice] = useState("");
  const [consented, setConsented] = useState(false);
  const nextPhotoId = useRef(0);

  const setProgress = (id: number, progress: number | null) =>
    setPhotos((current) => current.map((p) => (p.id === id ? { ...p, progress } : p)));

  const runSubmit = async (
    prevState: SellerFormState,
    formData: FormData,
  ): Promise<SellerFormState> => {
    const attempt = prevState.attempt + 1;
    const values = sellerFieldsFromFormData(formData);
    const fail = (errors: SellerFieldErrors, generalError = ""): SellerFormState => ({
      attempt,
      ok: false,
      errors,
      generalError,
      values,
    });

    // Nothing leaves the browser until the photos pass the same checks the
    // server will run.
    if (photos.length === 0) return fail({ photos: PHOTOS_NONE_COPY });
    if (photos.length > MAX_PHOTOS) return fail({ photos: PHOTOS_TOO_MANY_COPY });
    if (photos.some((p) => p.error)) return fail({});

    try {
      const prepared = await prepareSellerPhotoUploads(
        values,
        photos.map(({ file }) => ({ type: file.type, size: file.size })),
      );

      if (prepared.kind === "done")
        return { attempt, ok: true, errors: {}, generalError: "", values };
      if (prepared.kind === "invalid") return fail(prepared.errors, prepared.generalError);

      try {
        await Promise.all(
          prepared.uploads.map(({ signedUrl }, index) => {
            const { id, file } = photos[index];
            setProgress(id, 0);
            return uploadPhoto(signedUrl, file, (fraction) => setProgress(id, fraction));
          }),
        );
      } catch {
        // The files stay chosen. A retry asks for fresh URLs under a new id.
        for (const { id } of photos) setProgress(id, null);
        return fail({}, SELLER_UPLOAD_ERROR_COPY);
      }

      const submitted = await submitSellerSubmission(
        values,
        prepared.submissionId,
        prepared.uploads.map(({ path }) => path),
      );

      if (!submitted.ok) return fail(submitted.errors, submitted.generalError);

      posthog.capture("seller_submission_created", {
        photo_count: photos.length,
        condition: values.condition,
      });
      return { attempt, ok: true, errors: {}, generalError: "", values };
    } catch {
      return fail({}, SELLER_ERROR_COPY);
    }
  };

  const [state, formAction, isPending] = useActionState(runSubmit, initialSellerFormState);

  if (state.ok) {
    return (
      <p role="status" className="text-sm">
        {sellerSuccessCopy(state.values.email.trim().toLowerCase())}
      </p>
    );
  }

  const handlePhotosChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    // Cleared so choosing the same file again still fires a change.
    event.target.value = "";

    const room = MAX_PHOTOS - photos.length;
    setPhotoNotice(chosen.length > room ? PHOTOS_TOO_MANY_COPY : "");
    setPhotos([
      ...photos,
      ...chosen.slice(0, Math.max(room, 0)).map((file) => ({
        id: nextPhotoId.current++,
        file,
        error: checkPhotoFile(file),
        progress: null,
      })),
    ]);
  };

  const removePhoto = (id: number) => {
    setPhotoNotice("");
    setPhotos(photos.filter((p) => p.id !== id));
  };

  const { errors, values, attempt } = state;
  const hasPhotoError = photos.some((p) => p.error);
  const photosError = photoNotice || errors.photos;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4 max-w-xl">
      <fieldset className="flex flex-col gap-4" disabled={isPending}>
        <legend className="uppercase tracking-[0.2em] text-xs mb-2">About you</legend>

        <Field name="name" label="Your name" error={errors.name}>
          {(props) => (
            // Re-keyed per attempt: React resets an uncontrolled form when the
            // action starts, so the echoed values re-seed it after an error.
            <input
              key={`name-${attempt}`}
              {...props}
              type="text"
              autoComplete="name"
              defaultValue={values.name}
            />
          )}
        </Field>

        <Field name="email" label="Email" error={errors.email}>
          {(props) => (
            <input
              key={`email-${attempt}`}
              {...props}
              type="email"
              autoComplete="email"
              defaultValue={values.email}
            />
          )}
        </Field>

        <Field name="phone" label="Phone (optional)" error={errors.phone}>
          {(props) => (
            <input
              key={`phone-${attempt}`}
              {...props}
              type="tel"
              autoComplete="tel"
              defaultValue={values.phone}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={isPending}>
        <legend className="uppercase tracking-[0.2em] text-xs mb-2">The piece</legend>

        <Field name="title" label="Title" error={errors.title}>
          {(props) => (
            <input key={`title-${attempt}`} {...props} type="text" defaultValue={values.title} />
          )}
        </Field>

        <Field name="makerOrBrand" label="Maker or brand (optional)" error={errors.makerOrBrand}>
          {(props) => (
            <input
              key={`maker-${attempt}`}
              {...props}
              type="text"
              defaultValue={values.makerOrBrand}
            />
          )}
        </Field>

        <Field name="materials" label="Materials" error={errors.materials}>
          {(props) => (
            <input
              key={`materials-${attempt}`}
              {...props}
              type="text"
              defaultValue={values.materials}
            />
          )}
        </Field>

        <Field name="dimensions" label="Dimensions (optional)" error={errors.dimensions}>
          {(props) => (
            <input
              key={`dimensions-${attempt}`}
              {...props}
              type="text"
              placeholder="e.g. 40 × 30 × 90 cm"
              defaultValue={values.dimensions}
            />
          )}
        </Field>

        <Field name="condition" label="Condition" error={errors.condition}>
          {(props) => (
            <select key={`condition-${attempt}`} {...props} defaultValue={values.condition}>
              <option value="">Choose one</option>
              {SELLER_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {SELLER_CONDITION_LABELS[condition]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field name="askingPrice" label="Asking price in euros" error={errors.askingPrice}>
          {({ className, ...props }) => (
            <div className="flex items-center gap-2">
              <span aria-hidden="true">€</span>
              <input
                key={`price-${attempt}`}
                {...props}
                className={className}
                type="text"
                inputMode="decimal"
                placeholder="120"
                defaultValue={values.askingPrice}
              />
            </div>
          )}
        </Field>

        <Field
          name="description"
          label="Description"
          error={errors.description}
          helper="Story, provenance, anything the owner should know"
        >
          {(props) => (
            <textarea
              key={`description-${attempt}`}
              {...props}
              rows={5}
              defaultValue={values.description}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <label htmlFor="seller-photos" className="seller-photos-label text-sm">
            Photos
          </label>
          <input
            // No `name`: the files must never be part of the FormData sent to
            // a Server Action. They live in state and go straight to Storage.
            id="seller-photos"
            type="file"
            multiple
            accept={ALLOWED_PHOTO_TYPES.join(",")}
            onChange={handlePhotosChosen}
            aria-invalid={!!photosError}
            aria-describedby={`seller-photos-helper${photosError ? " seller-photos-error" : ""}`}
            className="text-sm"
          />
          <span id="seller-photos-helper" className="text-xs">
            Up to {MAX_PHOTOS} photos, JPEG, PNG or WebP, 5 MB each.
          </span>
          {photosError && (
            <span id="seller-photos-error" className="text-red-500 text-xs">
              {photosError}
            </span>
          )}

          {photos.length > 0 && (
            <ul aria-label="Chosen photos" className="flex flex-col gap-2 text-sm">
              {photos.map(({ id, file, error, progress }) => (
                <li key={id} className="flex flex-wrap items-center gap-3">
                  <span className="truncate max-w-[20ch]">{file.name}</span>
                  {error && (
                    <span className="text-red-500 text-xs">
                      {file.name}: {error}
                    </span>
                  )}
                  {progress !== null && (
                    <progress aria-label={`Uploading ${file.name}`} value={progress} max={1} />
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(id)}
                    aria-label={`Remove ${file.name}`}
                    className="underline text-xs cursor-pointer"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      {/* Honeypot: off-screen and hidden from assistive tech. Humans never
          fill it; bots that fill every field get a silent success. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor="seller-website">Website</label>
        <input
          id="seller-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          name="contactConsent"
          type="checkbox"
          // Controlled so submit can stay disabled until it is ticked.
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-1"
          disabled={isPending}
        />
        {SELLER_CONTACT_CONSENT_COPY}
      </label>
      {errors.contactConsent && (
        <span className="text-red-500 text-xs">{errors.contactConsent}</span>
      )}

      {state.generalError && (
        <p className="text-red-500 text-sm" role="alert" aria-live="polite">
          {state.generalError}
        </p>
      )}

      <button
        type="submit"
        disabled={!consented || isPending || hasPhotoError}
        className="self-start uppercase tracking-[0.2em] text-xs border border-current px-4 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Sending…" : "Send to the owner"}
      </button>
    </form>
  );
}
