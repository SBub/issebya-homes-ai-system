"use client";

import posthog from "posthog-js";
import { useActionState, useState } from "react";
import {
  initialWishlistState,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SUCCESS_COPY,
  type WishlistFormState,
} from "@/lib/shop/wishlist";
import { addToWishlist } from "../actions";

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

type WishlistFormProps = {
  productSlug: string;
};

export function WishlistForm({ productSlug }: WishlistFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [remembered, setRemembered] = useState({ email: "", consent: false });
  const formId = `wishlist-form-${productSlug}`;

  // localStorage is read here, in the click handler, and never during
  // render: the page is prerendered, so reading it while rendering would make
  // the first client render differ from the static HTML.
  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setRemembered(readRemembered());
    setIsOpen(true);
    posthog.capture("wishlist_form_opened", { product_slug: productSlug });
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={formId}
        className="self-start uppercase tracking-[0.2em] text-xs border border-current px-4 py-2 cursor-pointer"
      >
        Add to wishlist
      </button>

      {isOpen && (
        <WishlistFields
          formId={formId}
          productSlug={productSlug}
          rememberedEmail={remembered.email}
          rememberedConsent={remembered.consent}
        />
      )}
    </div>
  );
}

type WishlistFieldsProps = {
  formId: string;
  productSlug: string;
  rememberedEmail: string;
  rememberedConsent: boolean;
};

// Mounted only once the visitor opens the form, so the checkbox state below
// is seeded from the remembered consent at mount time.
function WishlistFields({
  formId,
  productSlug,
  rememberedEmail,
  rememberedConsent,
}: WishlistFieldsProps) {
  const [optedIn, setOptedIn] = useState(rememberedConsent);

  const runAddToWishlist = async (
    prevState: WishlistFormState,
    formData: FormData,
  ): Promise<WishlistFormState> => {
    const next = await addToWishlist(prevState, formData);
    if (next.ok) {
      rememberWishlistEmail(next.email);
      posthog.capture("wishlist_item_added", { product_slug: productSlug });
    }
    return next;
  };

  const [state, formAction, isPending] = useActionState(runAddToWishlist, initialWishlistState);

  if (state.ok) {
    return (
      <p id={formId} role="status" className="text-sm">
        {WISHLIST_SUCCESS_COPY}
      </p>
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
