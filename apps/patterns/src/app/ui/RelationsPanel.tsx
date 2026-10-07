import Link from "next/link";
import { pullUrl } from "@/lib/patterns/links";
import { getUsedBy, getUses } from "@/lib/patterns/registry";
import type { PatternDoc } from "@/lib/patterns/schema";

function PatternLinks({ heading, patterns }: { heading: string; patterns: PatternDoc[] }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-[0.2em] mb-2">{heading}</h2>
      <ul className="space-y-1">
        {patterns.map((pattern) => (
          <li key={pattern.slug}>
            <Link href={`/p/${pattern.slug}`} className="text-secondary-link">
              {pattern.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The doc's side panel: what a composite combines, or which composites use an
 * atom (hidden when none do), then the code paths, the PRs that verified it
 * and when it was last checked.
 */
export function RelationsPanel({ pattern }: { pattern: PatternDoc }) {
  const usedBy = pattern.kind === "atom" ? getUsedBy(pattern.slug) : [];

  return (
    <aside className="text-sm space-y-6 lg:border-l lg:border-gray-300 lg:pl-6">
      {pattern.kind === "composite" && (
        <PatternLinks heading="Combines" patterns={getUses(pattern)} />
      )}
      {usedBy.length > 0 && <PatternLinks heading="Used by" patterns={usedBy} />}

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] mb-2">Code</h2>
        <ul className="space-y-1">
          {pattern.code.map((entry) => (
            <li key={`${entry.path}@${entry.ref}`} className="text-xs break-all">
              <code>{entry.path}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] mb-2">Verified in</h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {pattern.verifiedIn.map((pr) => (
            <li key={pr}>
              <a href={pullUrl(pr, pattern.repo)} rel="noreferrer" className="text-secondary-link">
                #{pr}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-gray-600">Updated {pattern.updated}</p>
    </aside>
  );
}
