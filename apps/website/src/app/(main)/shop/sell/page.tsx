import type { Metadata } from "next";
import { Breadcrumb } from "@/app/ui/Breadcrumb";
import { SITE_URL } from "@/lib/site";
import { SellerForm } from "./ui/SellerForm";

export const metadata: Metadata = {
  title: "Offer a piece - issebya.homes",
  description:
    "Have something that would sit well in the house at issebya.homes? Send photos, details and your price.",
  alternates: { canonical: `${SITE_URL}/shop/sell` },
};

// Reads nothing from the request (no cookies(), no headers(), no
// searchParams), so this route stays part of the static shell. The form is a
// client island; everything it sends goes through its Server Actions.
export default function SellPage() {
  return (
    <article>
      <div className="px-4 pt-4 md:px-12 md:pt-12">
        <Breadcrumb parent={{ href: "/shop", label: "shop" }} title="Offer a piece" />
      </div>

      <div className="bg-shop-card text-foreground px-4 py-8 md:px-12 md:py-12 flex flex-col gap-6">
        <h1 className="text-price">Offer a piece</h1>
        <p className="text-sm leading-relaxed max-w-[65ch]">
          Made something, or found something, that would sit well in the house? Tell us about it and
          add a few photos. Sveta looks at every piece herself and will get back to you by email.
        </p>
        <SellerForm />
      </div>
    </article>
  );
}
