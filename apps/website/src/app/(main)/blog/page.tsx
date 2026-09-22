import { format } from "date-fns";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { fromCalendarDay } from "@/lib/date-utils";
import { allPosts } from "@/lib/blog/posts";

export const metadata: Metadata = {
  title: "Blog - issebya.homes",
  description: "Notes on Almoçageme, the Sintra-Cascais coast, and staying at issebya.homes.",
};

// Reads nothing from the request (no cookies(), no headers(), no
// searchParams), so this route stays part of the static shell.
export default function BlogIndexPage() {
  return (
    <div className="p-4 md:p-12">
      <h1 className="text-4xl font-hand font-bold mb-8">Blog</h1>

      {allPosts.length === 0 ? (
        <p className="text-sm leading-relaxed">No posts yet. Check back soon.</p>
      ) : (
        <ul className="space-y-10">
          {allPosts.map(({ slug, title, description, date, hero }) => (
            <li key={slug}>
              <Link
                href={`/blog/${slug}`}
                className="flex flex-col md:flex-row gap-4 md:gap-8 group"
              >
                {hero && (
                  <div className="page-decor-photo flex-shrink-0">
                    <Image
                      src={hero.src}
                      alt={hero.alt}
                      fill
                      className="object-cover"
                      sizes="(min-width: 640px) 320px, 100vw"
                    />
                  </div>
                )}
                <div className="flex flex-col">
                  <h2 className="text-price group-hover:underline underline-offset-4">{title}</h2>
                  <p className="text-xs text-gray-600 mt-1">
                    {format(fromCalendarDay(date), "d MMMM yyyy")}
                  </p>
                  <p className="text-sm leading-relaxed mt-2 max-w-[65ch]">{description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
