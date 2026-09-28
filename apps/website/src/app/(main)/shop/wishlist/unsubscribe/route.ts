import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/shared/supabase";
import { resolveUnsubscribe, unsubscribeResultPath } from "@/lib/shop/unsubscribe";

/**
 * The link in every wishlist confirmation email. A Route Handler rather than
 * a page: with `cacheComponents`, a page may only read `searchParams` under a
 * <Suspense>, and once that streams the status is fixed at 200, so redirects
 * would become client-side and render this token URL (and send it to
 * analytics). Here nothing renders: every outcome is a real 303 to a
 * token-free result page, and the invalid page itself answers 404.
 */
export async function GET(request: NextRequest) {
  // A repeated `token` param is as invalid as a missing one.
  const tokens = request.nextUrl.searchParams.getAll("token");
  const outcome = await resolveUnsubscribe(
    createAdminClient(),
    tokens.length === 1 ? tokens[0] : undefined,
  );

  return NextResponse.redirect(new URL(unsubscribeResultPath(outcome), request.url), 303);
}
