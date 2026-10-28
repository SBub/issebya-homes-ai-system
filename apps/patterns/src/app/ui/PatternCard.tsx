import Link from "next/link";
import type { PatternDoc } from "@/lib/patterns/schema";

/** One doc on the index: title link, summary, tags as plain labels. */
export function PatternCard({ pattern }: { pattern: PatternDoc }) {
  return (
    <article className="bg-shop-card px-4 py-4">
      <h3 className="text-lg font-bold">
        <Link href={`/p/${pattern.slug}`} className="underline underline-offset-4">
          {pattern.title}
        </Link>
      </h3>
      <p className="text-sm leading-relaxed mt-1">{pattern.summary}</p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
        {pattern.tags.map((tag) => (
          <li key={tag} className="text-xs border border-gray-400 px-2 py-0.5">
            {tag}
          </li>
        ))}
      </ul>
    </article>
  );
}
