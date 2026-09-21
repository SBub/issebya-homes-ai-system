/**
 * "Where did this booking start?", answered once.
 *
 * Two things here are not obvious from the code:
 *
 * 1. **This is the only definition of a valid return target.** A booking
 *    started from inside a blog post carries the post's path through Stripe
 *    Checkout so the confirmation page can offer a way back. That path is an
 *    open-redirect surface, so it is accepted only as `/blog/<slug>` where the
 *    slug names a post the registry actually has. Shape alone is not enough
 *    (`/blog/does-not-exist` passes the regex), and existence alone is not
 *    enough (nothing else rejects `https://evil.example/`), so both checks
 *    live here rather than at either call site.
 *
 * 2. **It is called at both trust boundaries, and that is not duplication.**
 *    `submitBooking` validates an argument the browser sent; the confirmation
 *    page validates a query parameter that came back through a third party
 *    and that anyone can type by hand. Those are different values from
 *    different sources that merely look alike. Routing both through this
 *    function is what stops the two boundaries drifting apart on what counts
 *    as valid.
 *
 * The shape rule itself lives next to the checkout schema, since that is the
 * boundary Zod already guards, and it is coupled to the post slug convention
 * in `./schema` (lowercase alphanumeric plus single hyphens). A future post
 * with a different slug charset would parse as a post but silently lose its
 * return link; change both rules together.
 */
import { blogReturnPathSchema } from "@/lib/shared/schemas/booking";
import { getPostBySlug } from "./posts";

/**
 * The id on the booking widget's `<aside>`, and therefore the fragment a
 * return from checkout lands on. Exported so the widget and the URLs that
 * point at it cannot disagree.
 */
export const BOOKING_WIDGET_ANCHOR_ID = "book";

type BlogReturn = {
  /** The bare post path, e.g. `/blog/a-weekend-in-almocageme`. */
  path: string;
  /** The same path, anchored at the widget. */
  href: string;
  /** The post's real title, for link text. */
  title: string;
};

export function resolveBlogReturn(value: string | null | undefined): BlogReturn | null {
  if (!value) return null;

  const parsed = blogReturnPathSchema.safeParse(value);
  if (!parsed.success) return null;

  const path = parsed.data;
  const post = getPostBySlug(path.slice("/blog/".length));
  if (!post) return null;

  return { path, href: `${path}#${BOOKING_WIDGET_ANCHOR_ID}`, title: post.title };
}
