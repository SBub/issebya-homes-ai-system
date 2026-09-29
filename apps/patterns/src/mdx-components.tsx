import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";

/**
 * Required by `@next/mdx` in the App Router: without this file MDX does not
 * compile at all.
 *
 * Mirrors apps/website's typography mapping. `<Combines />` and
 * `<CodeLinks />` are deliberately not registered here: they depend on the
 * doc being rendered, so `/p/[slug]` passes them bound to that doc.
 */
const components = {
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-2xl font-bold mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-xl font-bold mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-sm leading-relaxed mb-4 [overflow-wrap:anywhere]">{children}</p>
  ),
  a: ({ children, ...props }: { children?: ReactNode; href?: string }) => (
    <a {...props} className="text-secondary-link">
      {children}
    </a>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc pl-5 text-sm leading-relaxed mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-5 text-sm leading-relaxed mb-4 space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="[overflow-wrap:anywhere]">{children}</li>
  ),
  // Inline code only. Code blocks arrive already highlighted by
  // rehype-pretty-code, which marks its own <code> with data attributes.
  code: ({ children, ...props }: { children?: ReactNode }) =>
    "data-language" in props ? (
      <code {...props}>{children}</code>
    ) : (
      <code className="rounded-sm bg-white/70 px-1 py-0.5 text-[0.85em] [overflow-wrap:anywhere]">
        {children}
      </code>
    ),
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
