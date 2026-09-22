import { format } from "date-fns";
import type { Metadata } from "next";
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
    <div className="max-w-2xl mx-auto px-6 md:px-12 py-8 space-y-8">
      <h1 className="text-4xl font-hand font-bold">Blog</h1>

      {allPosts.length === 0 ? (
        <p className="text-sm leading-relaxed">No posts yet. Check back soon.</p>
      ) : (
        <ul className="space-y-8">
          {allPosts.map(({ slug, title, description, date }) => (
            <li key={slug}>
              <Link href={`/blog/${slug}`} className="block group">
                <h2 className="text-price">{title}</h2>
                <p className="text-xs text-gray-600 mt-1">
                  {format(fromCalendarDay(date), "d MMMM yyyy")}
                </p>
                <p className="text-sm leading-relaxed mt-2">{description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
