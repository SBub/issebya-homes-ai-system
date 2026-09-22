import type { MDXComponents } from "mdx/types";
import Image, { type ImageProps } from "next/image";
import type { ReactNode } from "react";
import { BookingWidget } from "@/app/(main)/blog/ui/BookingWidget";

/**
 * Required by `@next/mdx` in the App Router: without this file MDX does not
 * compile at all.
 *
 * It maps the markdown elements a post actually uses onto the site's existing
 * typography (`font-hand` headings, `text-sm leading-relaxed` body, underlined
 * links) rather than inventing a second type scale, and it puts
 * `<BookingWidget />` in scope for every post so an author can drop the
 * booking engine mid-article with no import.
 */
const components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="text-3xl md:text-4xl font-hand font-bold mt-8 mb-4">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-2xl font-hand font-bold mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-xl font-hand font-bold mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-sm leading-relaxed mb-4">{children}</p>
  ),
  a: ({ children, ...props }: { children?: ReactNode; href?: string }) => (
    <a {...props} className="underline hover:text-gray-600">
      {children}
    </a>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc pl-5 text-sm leading-relaxed mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-5 text-sm leading-relaxed mb-4 space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-l-2 border-gray-400 pl-4 italic text-sm leading-relaxed mb-4">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-gray-300" />,
  // next/image for every image, per apps/website/AGENTS.md. The MDX author
  // supplies width and height, which next/image needs for a string src.
  // `alt` is pulled out and passed explicitly rather than arriving via the
  // spread, so it is statically visible to jsx-a11y and an image without it
  // fails lint instead of shipping.
  img: ({ alt, ...props }: ImageProps) => (
    <Image alt={alt} sizes="100vw" style={{ width: "100%", height: "auto" }} {...props} />
  ),
  BookingWidget,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
