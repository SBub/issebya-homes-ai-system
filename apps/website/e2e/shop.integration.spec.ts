import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { filterByName, SHOP_PAGE_SIZE, sortProducts } from "@/lib/shop/pagination";
import { allProducts } from "@/lib/shop/products";
import {
  SELLER_CONTACT_CONSENT_COPY,
  SELLER_SUBMISSIONS_BUCKET,
  sellerSuccessCopy,
} from "@/lib/shop/seller-submission";
import {
  WISHLIST_ALREADY_UNSUBSCRIBED_COPY,
  WISHLIST_DIALOG_HEADING,
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SAVE_LABEL,
  WISHLIST_SAVED_LABEL,
  WISHLIST_SUCCESS_COPY,
  WISHLIST_UNSUBSCRIBE_INVALID_COPY,
  WISHLIST_UNSUBSCRIBED_COPY,
  wishlistEmailSentCopy,
} from "@/lib/shop/wishlist";
import { createAdminClient, createClient } from "@/lib/shared/supabase";
import { SITE_URL } from "@/lib/site";

// The catalogue reads no database. The wishlist tests write to the shared
// local DB, each under its own unique email, and delete that contact
// afterwards (its items cascade). The Playwright server runs with
// E2E_MOCK_RESEND=true, so a new wish never emails these addresses.
const newest = sortProducts(allProducts, "newest");
const oldest = sortProducts(allProducts, "oldest");
const [firstProduct] = newest;
// The card carousel only renders arrows for a product with more than one image.
const carouselProduct = newest.find((product) => product.images.length > 1);
const silverNewest = sortProducts(filterByName(allProducts, "silver"), "newest");
const silverOldest = sortProducts(filterByName(allProducts, "silver"), "oldest");
// A term broad enough to need more than two pages of results.
const WIDE_TERM = "e";
const wideMatches = filterByName(allProducts, WIDE_TERM);
const names = (products: readonly { name: string }[]) => products.map(({ name }) => name);

test.describe("Shop", () => {
  test("index shows the six newest product cards, in order, linking to /shop/…", async ({
    page,
  }) => {
    await page.goto("/shop");

    const grid = page.getByRole("region", { name: "Products" });
    await expect(grid.getByRole("article")).toHaveCount(SHOP_PAGE_SIZE);
    const expected = newest.slice(0, SHOP_PAGE_SIZE);
    await expect(grid.getByRole("article").getByRole("link")).toHaveText(
      expected.map(({ name }) => name),
    );
    for (const product of expected) {
      await expect(grid.getByRole("link", { name: product.name, exact: true })).toHaveAttribute(
        "href",
        `/shop/${product.slug}`,
      );
    }
  });

  test("scrolling loads the next pages of products", async ({ page }) => {
    await page.goto("/shop");

    const cards = page.getByRole("region", { name: "Products" }).getByRole("article");
    const sentinel = page.getByTestId("shop-products-sentinel");
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE);

    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE * 2);
    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(allProducts.length);

    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    const last = newest[newest.length - 1];
    await expect(page.getByRole("link", { name: last.name, exact: true })).toHaveAttribute(
      "href",
      `/shop/${last.slug}`,
    );
  });

  test("Load more button loads the next page", async ({ page }) => {
    await page.goto("/shop");

    const cards = page.getByRole("region", { name: "Products" }).getByRole("article");
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE);

    await page.getByRole("button", { name: "Load more" }).click();
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE * 2);
  });

  test("first page is not fetched from the API", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/shop/products")) apiRequests.push(req.url());
    });

    await page.goto("/shop");
    await expect(page.getByRole("region", { name: "Products" }).getByRole("article")).toHaveCount(
      SHOP_PAGE_SIZE,
    );

    expect(apiRequests).toEqual([]);
  });

  test("the products API pages with an opaque cursor", async ({ request }) => {
    const res = await request.get("/api/shop/products");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(SHOP_PAGE_SIZE);
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    expect((await request.get("/api/shop/products?limit=30")).status()).toBe(400);

    const oldestRes = await request.get("/api/shop/products?sort=oldest");
    expect(oldestRes.status()).toBe(200);
    expect((await oldestRes.json()).items[0].slug).toBe(oldest[0].slug);

    const crossSort = await request.get(`/api/shop/products?sort=oldest&cursor=${body.nextCursor}`);
    expect(crossSort.status()).toBe(400);
    expect((await request.get("/api/shop/products?sort=bogus")).status()).toBe(400);

    const teenRes = await request.get("/api/shop/products?q=silver");
    expect(teenRes.status()).toBe(200);
    const teen = await teenRes.json();
    expect(teen.items).toHaveLength(silverNewest.length);
    expect(teen.total).toBe(silverNewest.length);
    expect(teen.nextCursor).toBeNull();

    const product = await (await request.get(`/api/shop/products?q=${WIDE_TERM}`)).json();
    const crossSearch = await request.get(
      `/api/shop/products?q=silver&cursor=${product.nextCursor}`,
    );
    expect(crossSearch.status()).toBe(400);
    expect((await request.get(`/api/shop/products?q=${"a".repeat(61)}`)).status()).toBe(400);
  });

  test("sort control switches order and keeps it in the URL", async ({ page }) => {
    await page.goto("/shop");

    const grid = page.getByRole("region", { name: "Products" });
    const cards = grid.getByRole("article");
    const cardLinks = cards.getByRole("link");
    const sort = page.getByLabel("Sort");
    await expect(cardLinks.first()).toHaveText(newest[0].name);

    await sort.selectOption({ label: "Oldest first" });
    await expect(page).toHaveURL("/shop?sort=oldest");
    await expect(cardLinks.first()).toHaveText(oldest[0].name);

    const sentinel = page.getByTestId("shop-products-sentinel");
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE);
    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE * 2);
    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(allProducts.length);
    await expect(cardLinks).toHaveText(oldest.map(({ name }) => name));

    await sort.selectOption({ label: "Newest first" });
    await expect(page).toHaveURL("/shop");
    await expect(cardLinks.first()).toHaveText(newest[0].name);

    await page.goBack();
    await expect(page).toHaveURL("/shop?sort=oldest");
    await expect(cardLinks.first()).toHaveText(oldest[0].name);
  });

  test("a shared oldest link opens in that order without an API call for page one", async ({
    page,
  }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/shop/products")) apiRequests.push(req.url());
    });

    await page.goto("/shop?sort=oldest");

    const cardLinks = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .getByRole("link");
    await expect(cardLinks).toHaveText(oldest.slice(0, SHOP_PAGE_SIZE).map(({ name }) => name));
    await expect(page.getByLabel("Sort")).toHaveValue("oldest");
    expect(apiRequests).toEqual([]);
  });

  test("search narrows the grid after a pause and keeps the term in the URL", async ({ page }) => {
    await page.goto("/shop");

    const cardLinks = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .getByRole("link");
    const search = page.getByRole("searchbox", { name: "Search products" });
    await expect(cardLinks).toHaveCount(SHOP_PAGE_SIZE);

    await search.pressSequentially("silver");
    await expect(page).toHaveURL("/shop?q=silver");
    await expect(cardLinks).toHaveText(names(silverNewest));

    await search.fill("");
    await expect(page).toHaveURL("/shop");
    await expect(cardLinks).toHaveCount(SHOP_PAGE_SIZE);
  });

  test("Enter applies the search immediately", async ({ page }) => {
    await page.goto("/shop");

    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.pressSequentially("silver");
    await search.press("Enter");

    await expect(page).toHaveURL("/shop?q=silver");
    await expect(page.getByRole("region", { name: "Products" }).getByRole("article")).toHaveCount(
      silverNewest.length,
    );
  });

  test("a shared search link streams its results without an API call", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/shop/products")) apiRequests.push(req.url());
    });

    await page.goto("/shop?sort=oldest&q=silver");

    const cardLinks = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .getByRole("link");
    await expect(cardLinks).toHaveText(names(silverOldest));
    await expect(page.getByRole("searchbox", { name: "Search products" })).toHaveValue("silver");
    await expect(page.getByLabel("Sort")).toHaveValue("oldest");
    expect(apiRequests).toEqual([]);
  });

  test("searching keeps infinite scroll working inside the results", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/shop/products")) apiRequests.push(req.url());
    });

    await page.goto(`/shop?q=${WIDE_TERM}`);

    const cards = page.getByRole("region", { name: "Products" }).getByRole("article");
    const sentinel = page.getByTestId("shop-products-sentinel");
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE);
    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(SHOP_PAGE_SIZE * 2);
    await sentinel.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(wideMatches.length);

    expect(apiRequests.length).toBeGreaterThan(0);
    for (const url of apiRequests) {
      expect(new URL(url).searchParams.get("q")).toBe(WIDE_TERM);
    }
  });

  test("a term with no matches shows the empty message and Clear restores the grid", async ({
    page,
  }) => {
    await page.goto("/shop");

    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.pressSequentially("teapot");

    await expect(
      page.getByText('Nothing matches "teapot". Try another word or clear the search.'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();

    await expect(page).toHaveURL("/shop");
    await expect(search).toHaveValue("");
    await expect(page.getByRole("region", { name: "Products" }).getByRole("article")).toHaveCount(
      SHOP_PAGE_SIZE,
    );
  });

  test("changing sort keeps the search", async ({ page }) => {
    await page.goto("/shop?q=silver");

    const cardLinks = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .getByRole("link");
    await expect(cardLinks).toHaveText(names(silverNewest));

    await page.getByLabel("Sort").selectOption({ label: "Oldest first" });

    await expect(page).toHaveURL("/shop?sort=oldest&q=silver");
    await expect(cardLinks).toHaveText(names(silverOldest));
  });

  test("flipping a card's images stays on /shop, then the name opens the product", async ({
    page,
  }) => {
    test.skip(!carouselProduct, "no product in the registry has more than one image");
    const product = carouselProduct!;
    await page.goto("/shop");

    const card = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .filter({ has: page.getByRole("link", { name: product.name, exact: true }) });
    const img = card.locator("img");
    await expect(img).toHaveAttribute("alt", product.images[0].alt);

    await card.getByRole("button", { name: "Next image" }).click();
    await expect(page).toHaveURL("/shop");
    await expect(img).toHaveAttribute("alt", product.images[1].alt);

    await card.getByRole("link", { name: product.name, exact: true }).click();
    await expect(page).toHaveURL(`/shop/${product.slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: product.name, exact: true }),
    ).toBeVisible();
  });

  // A coordinate click, not `locator.click()`: at the description's centre the
  // name link's stretched `::after` is on top, which Playwright's actionability
  // check reports as "intercepts pointer events". That is the behaviour under
  // test, and a mouse click there is what a visitor does. That the arrows
  // still do not navigate is the flipping test above.
  test("pressing a card's description opens the product", async ({ page }) => {
    await page.goto("/shop");

    const description = page
      .getByRole("region", { name: "Products" })
      .getByRole("article")
      .first()
      .getByText(firstProduct.description);
    await description.scrollIntoViewIfNeeded();
    const box = await description.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(page).toHaveURL(`/shop/${firstProduct.slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: firstProduct.name, exact: true }),
    ).toBeVisible();
  });

  test("the controls are in the page HTML", async ({ request }) => {
    // The dev server does not split the static shell from the streamed hole,
    // so this only proves the controls are in the first HTML response; the
    // production build's `◐ /shop` is what proves they are in the shell.
    const html = await (await request.get("/shop")).text();

    expect(html).toContain('aria-label="Search products"');
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`at ${viewport.width} px`, () => {
      test.use({ viewport });

      // Records, on the first frame where the skeleton is on screen, where the
      // search box and the first grid slot are, and sums every layout shift
      // inside the products section. Whether that skeleton frame was caught
      // (page one can arrive in the same frame) is not observable from here,
      // so both checks run: the positions when they were recorded, and a zero
      // layout-shift sum either way. Under `next dev`, `useSearchParams` does
      // not suspend, so the controls' fallback never renders and this cannot
      // fail on the dev server; run it against `next start` (PORT set to it)
      // to exercise the prerendered shell.
      test("controls and the first grid slot do not move when page one arrives", async ({
        page,
      }) => {
        await page.addInitScript(() => {
          type Box = { top: number; left: number };
          const w = window as unknown as {
            __skeleton?: { search: Box; slot: Box };
            __shift: number;
          };
          w.__shift = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as {
              value: number;
              hadRecentInput: boolean;
              sources?: { node?: Node | null }[];
            }[]) {
              if (entry.hadRecentInput) continue;
              const section = document.querySelector('section[aria-label="Products"]');
              const inSection = (entry.sources ?? []).some(
                ({ node }) => node && section?.contains(node),
              );
              if (inSection) w.__shift += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });

          const box = (el: Element): Box => {
            const { top, left } = el.getBoundingClientRect();
            return { top: top + window.scrollY, left: left + window.scrollX };
          };
          const poll = () => {
            const search = document.querySelector('input[aria-label="Search products"]');
            const slot = document.querySelector('ul[aria-hidden="true"] > li');
            if (search && slot) {
              w.__skeleton = { search: box(search), slot: box(slot) };
              return;
            }
            if (!document.querySelector("article")) requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        });

        await page.goto("/shop");
        const grid = page.getByRole("region", { name: "Products" });
        await expect(grid.getByRole("article")).toHaveCount(SHOP_PAGE_SIZE);

        const recorded = await page.evaluate(() => {
          const w = window as unknown as {
            __skeleton?: {
              search: { top: number; left: number };
              slot: { top: number; left: number };
            };
          };
          return w.__skeleton ?? null;
        });
        if (recorded) {
          const search = await page
            .getByRole("searchbox", { name: "Search products" })
            .boundingBox();
          const slot = await grid
            .locator("li", { has: page.getByRole("article") })
            .first()
            .boundingBox();
          const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
          expect(Math.abs((search?.y ?? 0) + scroll.y - recorded.search.top)).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs((search?.x ?? 0) + scroll.x - recorded.search.left)).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs((slot?.y ?? 0) + scroll.y - recorded.slot.top)).toBeLessThanOrEqual(1);
          expect(Math.abs((slot?.x ?? 0) + scroll.x - recorded.slot.left)).toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => (window as unknown as { __shift: number }).__shift)).toBe(
          0,
        );
      });
    });
  }

  test("index has no breadcrumb", async ({ page }) => {
    await page.goto("/shop");

    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  });

  test("clicking a card opens its details page and the breadcrumb returns", async ({ page }) => {
    await page.goto("/shop");

    const card = page.getByRole("link", { name: firstProduct.name, exact: true });
    const href = await card.getAttribute("href");
    expect(href).toBe(`/shop/${firstProduct.slug}`);

    await card.click();
    await expect(page).toHaveURL(`/shop/${firstProduct.slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: firstProduct.name, exact: true }),
    ).toBeVisible();

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const back = breadcrumb.getByRole("link", { name: "shop" });
    await expect(back).toHaveAttribute("href", "/shop");

    await back.click();
    await expect(page).toHaveURL("/shop");
  });

  test("unknown slug returns 404", async ({ page }) => {
    const res = await page.goto("/shop/does-not-exist");

    expect(res?.status()).toBe(404);
  });

  test("header shows Shop and marks it active on a product page only", async ({ page }) => {
    await page.goto(`/shop/${firstProduct.slug}`);

    const shopLink = page.locator("header").getByRole("link", { name: "Shop", exact: true });
    await expect(shopLink).toBeVisible();
    await expect(shopLink).toHaveClass(/border-b-2/);

    await page.goto("/blog");
    await expect(
      page.locator("header").getByRole("link", { name: "Shop", exact: true }),
    ).not.toHaveClass(/border-b-2/);
  });

  test("sitemap lists /shop, /shop/sell and every product", async ({ page }) => {
    const res = await page.request.get("/sitemap.xml");
    const body = await res.text();

    expect(body).toContain(`${SITE_URL}/shop</loc>`);
    expect(body).toContain(`${SITE_URL}/shop/sell</loc>`);
    for (const { slug } of allProducts) {
      expect(body).toContain(`${SITE_URL}/shop/${slug}</loc>`);
    }
  });
});

// Not run with `javaScriptEnabled: false`: the search box is in the static
// shell, but disabled until hydration (it is the controls' Suspense fallback),
// and the list sits in a streamed hole only an inline script reveals, so
// without JavaScript nothing can be typed or found. Instead this bypasses
// React's onSubmit with the native `form.submit()`, which is exactly the
// request the browser would build on its own.
test.describe("Shop search form", () => {
  test("the search box is a plain GET form", async ({ page }) => {
    await page.goto("/shop");

    await page.getByRole("search").evaluate((form: HTMLFormElement) => {
      (form.elements.namedItem("q") as HTMLInputElement).value = "silver";
      form.submit();
    });

    await expect(page).toHaveURL("/shop?q=silver");
    await expect(page.getByRole("region", { name: "Products" }).getByRole("article")).toHaveCount(
      silverNewest.length,
    );
  });
});

test.describe("Wishlist", () => {
  let email: string;

  test.beforeEach(() => {
    email = `e2e-wishlist-${randomUUID()}@example.com`;
  });

  test.afterEach(async () => {
    await createAdminClient().from("shop_wishlist_contacts").delete().eq("email", email);
  });

  test("wishing the same product twice stores one item and one consent", async ({ page }) => {
    await page.goto(`/shop/${firstProduct.slug}`);

    const trigger = page.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true });
    await expect(trigger).not.toHaveAttribute("aria-pressed");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Email").fill(email);

    const submit = dialog.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText(WISHLIST_OPT_IN_HELPER)).toBeVisible();

    await dialog.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
    await submit.click();
    const panel = dialog.getByRole("status");
    await expect(panel).toContainText(firstProduct.name);
    await expect(panel).toContainText(WISHLIST_SUCCESS_COPY);
    await expect(panel).toContainText(wishlistEmailSentCopy(email));
    const savedTrigger = page.getByRole("button", { name: WISHLIST_SAVED_LABEL, exact: true });
    await expect(savedTrigger).toHaveAttribute("aria-pressed", "true");
    await expect(savedTrigger.locator('svg[data-filled="true"]')).toHaveCount(1);
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    // Second visit: the trigger reads "Save to wishlist" again (in-memory by
    // design), and the email (and consent) come back from localStorage.
    await page.reload();
    await expect(trigger).not.toHaveAttribute("aria-pressed");
    await trigger.click();
    await expect(dialog.getByLabel("Email")).toHaveValue(email);
    await dialog.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
    await dialog.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click();
    // Already wished: saved, but no second email, so no "sent a note" line.
    await expect(dialog.getByRole("status")).toContainText(WISHLIST_SUCCESS_COPY);
    await expect(dialog.getByRole("status")).not.toContainText(wishlistEmailSentCopy(email));

    const supabase = createAdminClient();
    const { data: items } = await supabase
      .from("shop_wishlist_items")
      .select("email, product_slug")
      .eq("email", email)
      .eq("product_slug", firstProduct.slug);
    expect(items).toHaveLength(1);

    const { data: contacts } = await supabase
      .from("shop_wishlist_contacts")
      .select("marketing_opt_in, opt_in_copy")
      .eq("email", email);
    expect(contacts).toEqual([{ marketing_opt_in: true, opt_in_copy: WISHLIST_OPT_IN_COPY }]);
  });

  test("Escape closes the dialog and returns focus to the trigger", async ({ page }) => {
    await page.goto(`/shop/${firstProduct.slug}`);

    // Unique while the dialog is closed: its submit only mounts when open.
    const trigger = page.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a malformed unsubscribe link lands on a token-free 404", async ({ page }) => {
    const res = await page.goto("/shop/wishlist/unsubscribe?token=nonsense");

    expect(res?.status()).toBe(404);
    await expect(page).toHaveURL("/shop/wishlist/unsubscribe/invalid");
    await expect(page.getByText(WISHLIST_UNSUBSCRIBE_INVALID_COPY)).toBeVisible();
  });

  test("the unsubscribe link opts out, keeps the wish, and dies on re-consent", async ({
    page,
  }) => {
    const supabase = createAdminClient();
    const readContact = async () => {
      const { data } = await supabase
        .from("shop_wishlist_contacts")
        .select("marketing_opt_in, unsubscribed_at, unsubscribe_token")
        .eq("email", email)
        .single();
      return data;
    };
    const wish = async () => {
      await page.goto(`/shop/${firstProduct.slug}`);
      await page.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: WISHLIST_DIALOG_HEADING });
      await dialog.getByLabel("Email").fill(email);
      await dialog.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
      await dialog.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click();
      await expect(dialog.getByRole("status")).toContainText(WISHLIST_SUCCESS_COPY);
    };

    await wish();
    const oldToken = (await readContact())?.unsubscribe_token as string;
    const oldLink = `/shop/wishlist/unsubscribe?token=${oldToken}`;

    await page.goto(oldLink);
    await expect(page).toHaveURL("/shop/wishlist/unsubscribe/done");
    expect(page.url()).not.toContain("token");
    await expect(page.getByText(WISHLIST_UNSUBSCRIBED_COPY)).toBeVisible();

    const unsubscribed = await readContact();
    expect(unsubscribed?.marketing_opt_in).toBe(false);
    expect(unsubscribed?.unsubscribed_at).not.toBeNull();
    const { data: items } = await supabase
      .from("shop_wishlist_items")
      .select("product_slug")
      .eq("email", email);
    expect(items).toEqual([{ product_slug: firstProduct.slug }]);

    await page.goto(oldLink);
    await expect(page).toHaveURL("/shop/wishlist/unsubscribe/already");
    await expect(page.getByText(WISHLIST_ALREADY_UNSUBSCRIBED_COPY)).toBeVisible();

    // Consenting again rotates the token, so the old email's link is dead.
    await wish();
    const renewed = await readContact();
    expect(renewed?.marketing_opt_in).toBe(true);
    expect(renewed?.unsubscribed_at).toBeNull();
    expect(renewed?.unsubscribe_token).not.toBe(oldToken);

    const res = await page.goto(oldLink);
    expect(res?.status()).toBe(404);
    await expect(page).toHaveURL("/shop/wishlist/unsubscribe/invalid");
  });

  test("anon cannot read either wishlist table", async () => {
    const anon = createClient();

    for (const table of ["shop_wishlist_items", "shop_wishlist_contacts"]) {
      const { data, error } = await anon.from(table).select("*");
      expect(data).toBeNull();
      expect(error?.code).toBe("42501");
    }
  });
});

// The PNG file signature is enough: the bucket checks the declared type and
// the size, never the bytes.
const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("Seller submission", () => {
  let email: string;

  test.beforeEach(() => {
    email = `e2e-seller-${randomUUID()}@example.com`;
  });

  // Removes this test's photos and rows. Owner emails never go out: the
  // Playwright server runs with E2E_MOCK_RESEND.
  test.afterEach(async () => {
    const supabase = createAdminClient();
    const { data: rows } = await supabase
      .from("shop_seller_submissions")
      .select("id, photo_paths")
      .eq("seller_email", email);

    for (const row of rows ?? []) {
      await supabase.storage.from(SELLER_SUBMISSIONS_BUCKET).remove(row.photo_paths);
    }
    await supabase.from("shop_seller_submissions").delete().eq("seller_email", email);
  });

  test("the shop links to the sell page", async ({ page }) => {
    await page.goto("/shop");

    await page.getByRole("link", { name: "Offer it here." }).click();

    await expect(page).toHaveURL("/shop/sell");
    await expect(page.getByRole("heading", { level: 1, name: "Offer a piece" })).toBeVisible();
  });

  test("a seller submits a piece with two photos", async ({ page }) => {
    await page.goto("/shop/sell");

    await page.getByLabel("Your name").fill("E2E Seller");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Title").fill("Oak side table");
    await page.getByLabel("Materials").fill("Solid oak");
    await page.getByLabel("Condition").selectOption("vintage");
    await page.getByLabel("Asking price in euros").fill("120,50");
    await page
      .getByLabel("Description")
      .fill("Bought in Porto in the seventies, one small mark on the top.");
    await page.getByLabel("Photos").setInputFiles([
      { name: "front.png", mimeType: "image/png", buffer: TINY_PNG },
      { name: "back.png", mimeType: "image/png", buffer: TINY_PNG },
    ]);
    await page.getByRole("checkbox", { name: SELLER_CONTACT_CONSENT_COPY }).check();
    await page.getByRole("button", { name: "Send to the owner" }).click();

    await expect(page.getByText(sellerSuccessCopy(email))).toBeVisible({ timeout: 15000 });

    const supabase = createAdminClient();
    const { data: rows } = await supabase
      .from("shop_seller_submissions")
      .select("id, status, asking_price_cents, photo_paths")
      .eq("seller_email", email);
    expect(rows).toHaveLength(1);

    const [row] = rows ?? [];
    expect(row.status).toBe("new");
    expect(row.asking_price_cents).toBe(12050);
    expect(row.photo_paths).toHaveLength(2);
    for (const path of row.photo_paths as string[]) {
      expect(path.startsWith(`${row.id}/`)).toBe(true);
    }

    const { data: objects } = await supabase.storage.from(SELLER_SUBMISSIONS_BUCKET).list(row.id);
    expect(objects).toHaveLength(2);
  });

  test("anon cannot read seller submissions", async () => {
    const { data, error } = await createClient().from("shop_seller_submissions").select("*");

    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});
