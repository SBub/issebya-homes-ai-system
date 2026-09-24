import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
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
