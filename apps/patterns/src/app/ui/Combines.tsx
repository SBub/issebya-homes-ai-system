import Link from "next/link";
import type { PatternDoc } from "@/lib/patterns/schema";

/** The `## Combines` section of a composite: its atoms, in frontmatter order. */
export function Combines({ uses }: { uses: readonly PatternDoc[] }) {
  return (
    <ol className="list-decimal pl-5 text-sm leading-relaxed mb-4 space-y-2">
      {uses.map((atom) => (
        <li key={atom.slug}>
          <Link href={`/p/${atom.slug}`} className="text-secondary-link font-bold">
            {atom.title}
          </Link>
          : {atom.summary}
        </li>
      ))}
    </ol>
  );
}
