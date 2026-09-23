import Link from "next/link";

/**
 * The `<parent> › <title>` trail above a detail page's title, shared by blog
 * posts (`blog › <post title>`) and shop products (`shop › <product name>`).
 *
 * Two decisions here are not obvious from the markup:
 *
 * The parent link and the title arrive as props rather than being read back
 * off the URL with `usePathname()`. Each detail page already has them in scope
 * from its registry lookup, and keeping this component free of request data
 * and client hooks is what lets `/blog/[slug]` and `/shop/[slug]` stay in the
 * static shell under `cacheComponents` (see the comment block in
 * `blog/[slug]/page.tsx`).
 *
 * The `›` separator lives inside the current-page `<li>` as an `aria-hidden`
 * span rather than being a third list item. That way the `<ol>` exposes
 * exactly two entries to assistive tech, and the separator never lands in the
 * current item's accessible name.
 *
 * The current item is clamped to one line with an ellipsis. The full title is
 * still in the DOM and in the accessible name; the clamp only stops the trail
 * from repeating the H1 that sits directly under it, at full length, when the
 * title is long.
 */
export function Breadcrumb({
  parent,
  title,
}: {
  parent: { href: string; label: string };
  title: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center text-xs text-gray-600">
        <li className="shrink-0">
          <Link href={parent.href} className="underline hover:text-black">
            {parent.label}
          </Link>
        </li>
        <li aria-current="page" className="min-w-0 truncate">
          <span aria-hidden="true" className="mx-2">
            ›
          </span>
          {title}
        </li>
      </ol>
    </nav>
  );
}
