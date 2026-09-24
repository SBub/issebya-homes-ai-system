"use client";

import posthog from "posthog-js";
import { type MouseEvent, useActionState, useId, useRef, useState } from "react";
import {
  initialWishlistState,
  WISHLIST_DIALOG_HEADING,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SUCCESS_COPY,
  type WishlistFormState,
  wishlistEmailSentCopy,
} from "@/lib/shop/wishlist";
import { addToWishlist } from "../actions";
import { HeartIcon } from "./HeartIcon";

// A convenience only: the server never treats these as consent. Every submit
// sends the checkbox value, and the action re-validates and re-records it.
const EMAIL_KEY = "issebya.shop.wishlist.email";
const CONSENT_EMAIL_KEY = "issebya.shop.wishlist.consentEmail";

// Storage can throw (private mode, disabled storage). The form must still
// work, just without the prefill.
function readRemembered(): { email: string; consent: boolean } {
  try {
    const email = window.localStorage.getItem(EMAIL_KEY) ?? "";
    const consentEmail = window.localStorage.getItem(CONSENT_EMAIL_KEY);
    return { email, consent: email !== "" && consentEmail === email };
  } catch {
    return { email: "", consent: false };
  }
}

function rememberWishlistEmail(email: string) {
  try {
    window.localStorage.setItem(EMAIL_KEY, email);
    window.localStorage.setItem(CONSENT_EMAIL_KEY, email);
  } catch {
    // Nothing to do: the wish is saved, only the prefill is lost.
  }
}

type WishlistDialogProps = {
  productSlug: string;
  productName: string;
};

export function WishlistDialog({ productSlug, productName }: WishlistDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const heartRef = useRef<HTMLButtonElement>(null);
  // Whether this open session saved, for the dismissed event.
  const submittedRef = useRef(false);
  // In-memory on purpose: the heart is empty again after a reload.
  const [added, setAdded] = useState(false);
  // The fields render only while the dialog is open, so every open mounts a
  // fresh form seeded from `remembered`, and a closed success resets.
  const [isOpen, setIsOpen] = useState(false);
  const [remembered, setRemembered] = useState({ email: "", consent: false });
  const headingId = useId();
  const formId = `wishlist-form-${productSlug}`;

  // localStorage is read here, in the click handler, and never during
  // render: the page is prerendered, so reading it while rendering would make
  // the first client render differ from the static HTML.
  const handleOpen = () => {
    setRemembered(readRemembered());
    setIsOpen(true);
    submittedRef.current = false;
    dialogRef.current?.showModal();
    posthog.capture("wishlist_form_opened", { product_slug: productSlug });
  };

  const closeDialog = () => dialogRef.current?.close();

  // Fires for every way out: the Close buttons, Escape and a backdrop click.
  const handleClose = () => {
    posthog.capture("wishlist_dialog_dismissed", {
      product_slug: productSlug,
      had_submitted: submittedRef.current,
    });
    setIsOpen(false);
    heartRef.current?.focus();
  };

  // All content sits in an inner div and the dialog has no padding, so only
  // a click on the backdrop targets the dialog element itself.
  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) closeDialog();
  };

  const handleSaved = () => {
    setAdded(true);
    submittedRef.current = true;
  };

  return (
    <>
      <button
        ref={heartRef}
        type="button"
        onClick={handleOpen}
        aria-label={added ? "Added to wishlist" : "Add to wishlist"}
        aria-pressed={added ? true : undefined}
        aria-haspopup="dialog"
        className="inline-flex items-center justify-center min-w-11 min-h-11 cursor-pointer"
      >
        <HeartIcon filled={added} className="w-6 h-6" />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        onClose={handleClose}
        onClick={handleBackdropClick}
        className="m-auto p-0 backdrop:bg-black/50 bg-shop-card text-foreground max-w-md w-[calc(100%-2rem)]"
      >
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id={headingId} className="uppercase tracking-[0.2em] text-xs">
              {WISHLIST_DIALOG_HEADING}
            </h2>
            <button
              type="button"
              onClick={closeDialog}
              className="uppercase tracking-[0.2em] text-xs cursor-pointer"
            >
              Close
            </button>
          </div>

          {isOpen && (
            <WishlistFields
              formId={formId}
              productSlug={productSlug}
              productName={productName}
              rememberedEmail={remembered.email}
              rememberedConsent={remembered.consent}
              onSaved={handleSaved}
              onClose={closeDialog}
            />
          )}
        </div>
      </dialog>
    </>
  );
}

type WishlistFieldsProps = {
  formId: string;
  productSlug: string;
  productName: string;
  rememberedEmail: string;
  rememberedConsent: boolean;
  onSaved: () => void;
  onClose: () => void;
};

// Mounted each time the dialog opens, so the checkbox state below is seeded
// from the remembered consent at mount time.
function WishlistFields({
  formId,
  productSlug,
  productName,
  rememberedEmail,
  rememberedConsent,
  onSaved,
  onClose,
}: WishlistFieldsProps) {
  const [optedIn, setOptedIn] = useState(rememberedConsent);

  const runAddToWishlist = async (
    prevState: WishlistFormState,
    formData: FormData,
  ): Promise<WishlistFormState> => {
    const next = await addToWishlist(prevState, formData);
    if (next.ok) {
      rememberWishlistEmail(next.email);
      onSaved();
      posthog.capture("wishlist_item_added", { product_slug: productSlug });
    }
    return next;
  };

  const [state, formAction, isPending] = useActionState(runAddToWishlist, initialWishlistState);

  // A confirmation panel, not a toast: it stays until the visitor closes it.
  if (state.ok) {
    return (
      <div
        id={formId}
        role="status"
        className="border border-black bg-shop-card p-4 flex flex-col gap-3 text-sm"
      >
        <HeartIcon filled className="w-6 h-6" />
        <h3 className="text-base">{productName}</h3>
        <p>{WISHLIST_SUCCESS_COPY}</p>
        {state.created && <p>{wishlistEmailSentCopy(state.email)}</p>}
        <button
          type="button"
          onClick={onClose}
          className="self-start uppercase tracking-[0.2em] text-xs border border-current px-4 py-2 cursor-pointer"
        >
          Close
        </button>
      </div>
    );
  }

  const emailErrorId = `${formId}-email-error`;
  const helperId = `${formId}-helper`;
  const formError = state.errors.marketingOptIn || state.errors.productSlug || state.generalError;

  return (
    <form id={formId} action={formAction} noValidate className="flex flex-col gap-3 max-w-md">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${formId}-email`} className="text-sm">
          Email
        </label>
        <input
          // Re-keyed per attempt: React resets an uncontrolled form when the
          // action starts, so the echoed email re-seeds it after an error.
          key={`email-${state.attempt}`}
          id={`${formId}-email`}
          name="email"
          type="email"
          autoComplete="email"
          // Focus lands here on open rather than on the dialog's Close.
          autoFocus
          required
          defaultValue={state.attempt ? state.email : rememberedEmail}
          placeholder="your@email.com"
          className={`border px-3 py-2 text-sm bg-transparent ${state.errors.email ? "border-red-500" : "border-current"}`}
          aria-invalid={!!state.errors.email}
          aria-describedby={state.errors.email ? emailErrorId : undefined}
          disabled={isPending}
        />
        {state.errors.email && (
          <span id={emailErrorId} className="text-red-500 text-xs">
            {state.errors.email}
          </span>
        )}
      </div>

      <input type="hidden" name="productSlug" value={productSlug} readOnly />

      {/* Honeypot: off-screen and hidden from assistive tech. Humans never
          fill it; bots that fill every field get a silent success. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input
          id={`${formId}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          name="marketingOptIn"
          type="checkbox"
          // Controlled so submit can be disabled until it is ticked. Starts
          // unticked unless this browser already consented with the
          // remembered email: a marketing opt-in must be affirmative.
          checked={optedIn}
          onChange={(e) => setOptedIn(e.target.checked)}
          className="mt-1"
          disabled={isPending}
        />
        {WISHLIST_OPT_IN_COPY}
      </label>

      {formError && (
        <p className="text-red-500 text-sm" role="alert" aria-live="polite">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={!optedIn || isPending}
        aria-describedby={optedIn ? undefined : helperId}
        className="self-start uppercase tracking-[0.2em] text-xs border border-current px-4 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Save to wishlist
      </button>
      {!optedIn && (
        <p id={helperId} className="text-xs">
          {WISHLIST_OPT_IN_HELPER}
        </p>
      )}
    </form>
  );
}
