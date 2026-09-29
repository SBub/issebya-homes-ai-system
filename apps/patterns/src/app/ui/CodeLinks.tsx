import { blobUrl } from "@/lib/patterns/links";
import type { PatternMeta } from "@/lib/patterns/schema";

/**
 * The `## Code` section, rendered from frontmatter: every file that proves
 * the pattern, linked at its pinned commit.
 */
export function CodeLinks({ code }: { code: PatternMeta["code"] }) {
  return (
    <ul className="text-sm leading-relaxed mb-4 space-y-3">
      {code.map((entry) => (
        <li key={`${entry.path}@${entry.ref}`}>
          <a href={blobUrl(entry)} rel="noreferrer" className="text-secondary-link break-all">
            <code className="text-xs">{entry.path}</code>
          </a>{" "}
          <span className="text-xs text-gray-600">@ {entry.ref.slice(0, 7)}</span>
          <p className="text-sm">{entry.note}</p>
        </li>
      ))}
    </ul>
  );
}
