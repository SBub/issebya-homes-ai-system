import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  LOCKIN_FORM_INTRO,
  LOCKIN_FORM_REASON,
  LOCKIN_GALLERY,
  LOCKIN_HAPPENS,
  LOCKIN_HAPPENS_HEADING,
  LOCKIN_HERO_HEADLINE,
  LOCKIN_HERO_SUBLINE,
  LOCKIN_HOST_HEADING,
  LOCKIN_HOST_PHOTO,
  LOCKIN_HOST_TEXT,
  LOCKIN_META_TITLE,
  LOCKIN_OG_IMAGE_ALT,
  LOCKIN_SPACE_HEADING,
  LOCKIN_WHAT_IS,
  LOCKIN_WHAT_IS_HEADING,
  LOCKIN_WHY_AWAY,
  LOCKIN_WHY_AWAY_HEADING,
} from "@/lib/lockin-waitlist/copy";
import { WaitlistFullForm } from "./_components/WaitlistFullForm";
import { WaitlistShortForm } from "./_components/WaitlistShortForm";

// A JPEG with declared dimensions: WhatsApp's preview fetcher skips WebP and
// uses width/height to render without a second fetch.
const OG_IMAGE = {
  url: "/og/lockin-waitlist.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: LOCKIN_OG_IMAGE_ALT,
};

// An unreleased blueprint: never indexed, not in the sitemap, linked from
// nowhere. Metadata merges shallowly, so these openGraph/twitter objects
// replace the root layout's wholesale and carry their own title/description.
// The hero subline doubles as the description.
export const metadata: Metadata = {
  title: LOCKIN_META_TITLE,
  description: LOCKIN_HERO_SUBLINE,
  robots: { index: false, follow: false },
  openGraph: {
    title: LOCKIN_META_TITLE,
    description: LOCKIN_HERO_SUBLINE,
    url: "/lockin-waitlist",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: LOCKIN_META_TITLE,
    description: LOCKIN_HERO_SUBLINE,
    images: [OG_IMAGE.url],
  },
};

const ICON_PATHS: Record<(typeof LOCKIN_HAPPENS)[number]["icon"], ReactNode> = {
  // A door.
  room: (
    <>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <circle cx="14.5" cy="12" r="0.75" fill="currentColor" />
    </>
  ),
  // A phone, crossed out.
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M4 4l16 16" />
    </>
  ),
  // A target.
  focus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  // A checklist.
  plan: (
    <>
      <path d="M4 6l1.5 1.5L8 5" />
      <path d="M4 12l1.5 1.5L8 11" />
      <path d="M4 18l1.5 1.5L8 17" />
      <path d="M11 6h9M11 12h9M11 18h9" />
    </>
  ),
};

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-xs uppercase tracking-[0.25em] text-black/70">
      {children}
    </h2>
  );
}

function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-4 text-lg leading-relaxed md:text-xl">
      {items.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  );
}

const SECTION_CLASS = "mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 md:py-20";

// Static: reads no request data, so it prerenders under `cacheComponents`.
// Only the two forms are client components.
export default function LockinWaitlistPage() {
  return (
    <div className="bg-[#f0eeea] text-black">
      {/* Text-only hero, so the first paint needs no image. */}
      <section
        aria-labelledby="lockin-hero"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-12 pb-12 md:pt-24 md:pb-20"
      >
        <h1 id="lockin-hero" className="text-4xl leading-tight font-medium md:text-6xl">
          {LOCKIN_HERO_HEADLINE}
        </h1>
        <p className="text-lg leading-relaxed md:text-xl">{LOCKIN_HERO_SUBLINE}</p>
        <WaitlistShortForm />
      </section>

      <section aria-labelledby="lockin-what-is" className={SECTION_CLASS}>
        <SectionHeading id="lockin-what-is">{LOCKIN_WHAT_IS_HEADING}</SectionHeading>
        <Paragraphs items={LOCKIN_WHAT_IS} />
      </section>

      <section aria-labelledby="lockin-why-away" className={SECTION_CLASS}>
        <SectionHeading id="lockin-why-away">{LOCKIN_WHY_AWAY_HEADING}</SectionHeading>
        <Paragraphs items={LOCKIN_WHY_AWAY} />
      </section>

      <section aria-labelledby="lockin-happens" className={SECTION_CLASS}>
        <SectionHeading id="lockin-happens">{LOCKIN_HAPPENS_HEADING}</SectionHeading>
        <ul className="grid gap-6 sm:grid-cols-2">
          {LOCKIN_HAPPENS.map((point) => (
            <li key={point.title} className="flex items-start gap-4 bg-white p-5">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7 shrink-0"
              >
                {ICON_PATHS[point.icon]}
              </svg>
              <p className="leading-relaxed">
                <span className="font-medium">{point.title}</span>
                {point.text && `: ${point.text}`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="lockin-space"
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 md:py-20"
      >
        <SectionHeading id="lockin-space">{LOCKIN_SPACE_HEADING}</SectionHeading>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LOCKIN_GALLERY.map((photo) => (
            <li key={photo.src} className="relative aspect-[4/5] overflow-hidden">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="lockin-host" className={SECTION_CLASS}>
        <SectionHeading id="lockin-host">{LOCKIN_HOST_HEADING}</SectionHeading>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-full">
            <Image
              src={LOCKIN_HOST_PHOTO.src}
              alt={LOCKIN_HOST_PHOTO.alt}
              fill
              sizes="160px"
              className="object-cover"
            />
          </div>
          <p className="text-lg leading-relaxed">{LOCKIN_HOST_TEXT}</p>
        </div>
      </section>

      <section aria-labelledby="lockin-join" className={`${SECTION_CLASS} pb-20 md:pb-28`}>
        <h2 id="lockin-join" className="text-3xl leading-tight font-medium md:text-4xl">
          {LOCKIN_FORM_INTRO}
        </h2>
        <p className="text-lg leading-relaxed">{LOCKIN_FORM_REASON}</p>
        <WaitlistFullForm />
      </section>
    </div>
  );
}
