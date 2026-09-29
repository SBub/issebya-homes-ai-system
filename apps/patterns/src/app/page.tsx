import { atoms, composites } from "@/lib/patterns/registry";
import type { PatternDoc } from "@/lib/patterns/schema";
import { PatternCard } from "./ui/PatternCard";

function PatternColumn({ heading, patterns }: { heading: string; patterns: PatternDoc[] }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-[0.2em] mb-4">{heading}</h2>
      <ul className="space-y-4">
        {patterns.map((pattern) => (
          <li key={pattern.slug}>
            <PatternCard pattern={pattern} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PatternsIndexPage() {
  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold mb-2">Pattern library</h1>
      <p className="text-sm leading-relaxed mb-8 max-w-2xl">
        The React and Next patterns this codebase already runs, each with its mechanism, its
        pitfalls and a pinned link to the code. Atoms are single techniques; composites combine
        them.
      </p>
      <div className="grid gap-8 md:grid-cols-2">
        <PatternColumn heading="Atoms" patterns={atoms} />
        <PatternColumn heading="Composites" patterns={composites} />
      </div>
    </div>
  );
}
