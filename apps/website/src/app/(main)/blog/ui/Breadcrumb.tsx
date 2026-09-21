import Link from "next/link";

/**
 * The `blog › <post title>` trail above a post's title.
 *
 * Two decisions here are not obvious from the markup:
 *
 * The title arrives as a prop rather than being read back off the URL with
 * `usePathname()`. The post page already has it in scope from
 * `getPostBySlug(slug)`, and keeping this component free of request data and
 * client hooks is what lets `/blog/[slug]` stay in the static shell under
 * `cacheComponents` (see the comment block in `blog/[slug]/page.tsx`).
 *
 * The `›` separator lives inside the current-page `<li>` as an `aria-hidden`
 * span rather than being a third list item. That way the `<ol>` exposes
 * exactly two entries to assistive tech, and the separator never lands in the
 * current item's accessible name.
 */
export function Breadcrumb({ title }: { title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center text-xs text-gray-600">
        <li>
          <Link href="/blog" className="underline hover:text-black">
            blog
          </Link>
        </li>
        <li aria-current="page">
          <span aria-hidden="true" className="mx-2">
            ›
          </span>
          {title}
        </li>
      </ol>
    </nav>
  );
}
