import { expect, test } from "@playwright/test";
import { allProducts } from "@/lib/shop/products";
import { SITE_URL } from "@/lib/site";

// The shop reads no database, so unlike the booking specs there are no
// fixtures to seed or clean up.
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(firstProduct.name);

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
