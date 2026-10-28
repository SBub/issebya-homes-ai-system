import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeLinks } from "@/app/ui/CodeLinks";
import { Combines } from "@/app/ui/Combines";
import { RelationsPanel } from "@/app/ui/RelationsPanel";
import { allPatterns, getPattern, getUses } from "@/lib/patterns/registry";

export function generateStaticParams() {
  return allPatterns.map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const pattern = getPattern(slug);

  // An unknown slug is a 404, which the page itself raises with notFound().
  if (!pattern) return { title: "Pattern not found - Patterns" };

  return { title: `${pattern.title} - Patterns`, description: pattern.summary };
}

// Nothing here reads the request, so every slug prerenders. `dynamicParams`
// is left unset on purpose, as in apps/website's blog: notFound() already
// handles an unknown slug under `cacheComponents`.
export default async function PatternPage(props: PageProps<"/p/[slug]">) {
  const { slug } = await props.params;
  const pattern = getPattern(slug);

  if (!pattern) notFound();

  const { Content } = pattern;
  const uses = getUses(pattern);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <article className="min-w-0 max-w-3xl">
        <p className="uppercase tracking-[0.2em] text-xs">{pattern.kind}</p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1 mb-3">{pattern.title}</h1>
        <p className="text-base leading-relaxed mb-6">{pattern.summary}</p>
        <div className="lg:hidden mb-6">
          <RelationsPanel pattern={pattern} />
        </div>
        <Content
          components={{
            CodeLinks: () => <CodeLinks code={pattern.code} repo={pattern.repo} />,
            Combines: () => <Combines uses={uses} />,
          }}
        />
      </article>
      <div className="hidden lg:block">
        <RelationsPanel pattern={pattern} />
      </div>
    </div>
  );
}
