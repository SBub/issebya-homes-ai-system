import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { allProducts } from "@/lib/shop/products";
import {
  WISHLIST_OPT_IN_COPY,
  WISHLIST_OPT_IN_HELPER,
  WISHLIST_SUCCESS_COPY,
} from "@/lib/shop/wishlist";
import { createAdminClient, createClient } from "@/lib/shared/supabase";
import { SITE_URL } from "@/lib/site";

// The catalogue reads no database. The wishlist tests write to the shared
// local DB, each under its own unique email, and delete that contact
// afterwards (its items cascade).
const [firstProduct] = allProducts;

test.describe("Shop", () => {
  test("index lists six product cards linking to /shop/…", async ({ page }) => {
    await page.goto("/shop");

    const cards = page.getByRole("region", { name: "Products" }).locator('a[href^="/shop/"]');
    await expect(cards).toHaveCount(6);
  });

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

  test("sitemap lists /shop and every product", async ({ page }) => {
    const res = await page.request.get("/sitemap.xml");
    const body = await res.text();

    expect(body).toContain(`${SITE_URL}/shop</loc>`);
    for (const { slug } of allProducts) {
      expect(body).toContain(`${SITE_URL}/shop/${slug}</loc>`);
    }
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

    await page.getByRole("button", { name: "Add to wishlist" }).click();
    await page.getByLabel("Email").fill(email);

    const submit = page.getByRole("button", { name: "Save to wishlist" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(WISHLIST_OPT_IN_HELPER)).toBeVisible();

    await page.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
    await submit.click();
    await expect(page.getByText(WISHLIST_SUCCESS_COPY)).toBeVisible();

    // Second visit: the email (and consent) come back from localStorage.
    await page.reload();
    await page.getByRole("button", { name: "Add to wishlist" }).click();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await page.getByRole("checkbox", { name: WISHLIST_OPT_IN_COPY, exact: true }).check();
    await page.getByRole("button", { name: "Save to wishlist" }).click();
    await expect(page.getByText(WISHLIST_SUCCESS_COPY)).toBeVisible();

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

  test("anon cannot read either wishlist table", async () => {
    const anon = createClient();

    for (const table of ["shop_wishlist_items", "shop_wishlist_contacts"]) {
      const { data, error } = await anon.from(table).select("*");
      expect(data).toBeNull();
      expect(error?.code).toBe("42501");
    }
  });
});
