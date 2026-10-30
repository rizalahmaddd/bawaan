import { expect, test, type Page } from "@playwright/test";

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) < 744;
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1200;

const STORE = { slug: "tokoe2e", name: "Toko E2E" };

/** Dev login + one store with no open trip, so screenshots don't depend on countdowns. */
async function seedSeller(page: Page) {
  await page.request.post("/api/auth/dev-login?host=app", { data: { email: "e2e@bawaan.test", name: "E2E Seller" } });
  const me = await (await page.request.get("/api/auth/me?host=app")).json();
  if (!me.tenants.some((t: { slug: string }) => t.slug === STORE.slug)) {
    const res = await page.request.post("/api/tenants?host=app", { data: { name: STORE.name, slug: STORE.slug, waNumber: "081234567890" } });
    expect(res.ok()).toBeTruthy();
  }
}

async function open(page: Page, host: string, path = "/") {
  await page.goto(`${path}?host=${host}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

test("landing", async ({ page }) => {
  await open(page, "landing");
  await expect(page.locator("html")).toHaveAttribute("data-surface", "landing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Jastip rapi");
  await expect(page.getByRole("link", { name: "Buat toko gratis" })).toBeVisible();
  await expect(page).toHaveScreenshot("landing.png", { fullPage: true });
});

test("seller login", async ({ page }) => {
  await open(page, "app");
  await expect(page.getByRole("heading", { name: "Masuk ke Bawaan", level: 1 })).toBeVisible();
});

test("seller app shell", async ({ page }) => {
  await seedSeller(page);
  await open(page, "app");
  await expect(page.locator("html")).toHaveAttribute("data-surface", "app");
  await expect(page.getByRole("heading", { name: "Hari ini", level: 1 })).toBeVisible();
  if (isCompact(page)) {
    await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  } else if (isWide(page)) {
    await expect(page.getByRole("complementary", { name: "Menu" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Tampilkan sidebar" })).toBeVisible();
  }
  await expect(page).toHaveScreenshot("app.png");
});

test("store shell", async ({ page }) => {
  await seedSeller(page);
  await open(page, STORE.slug);
  await expect(page.locator("html")).toHaveAttribute("data-slug", STORE.slug);
  await expect(page.getByRole("heading", { name: STORE.name, level: 1 })).toBeVisible();
  await expect(page.getByText("Belum ada PO yang dibuka")).toBeVisible();
  await expect(page).toHaveScreenshot("store.png", { fullPage: true });
});

test("unknown store host", async ({ page }) => {
  const res = await page.goto("/?host=a.b");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Halaman ini tidak ada" })).toBeVisible();
});

test.describe("component gallery", () => {
  test("components", async ({ page }) => {
    await open(page, "app", "/gallery");
    await expect(page.getByRole("heading", { name: "Komponen", level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("gallery-components.png", { fullPage: true });
  });

  test("sheet", async ({ page }) => {
    await open(page, "app", "/gallery");
    await page.getByRole("button", { name: "Buka sheet" }).click();
    const dialog = page.getByRole("dialog", { name: "Tandai barang" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("gallery-sheet.png");
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await expect(dialog).toBeHidden();
  });

  test("orders split view", async ({ page }) => {
    await open(page, "app", "/gallery");
    if (isCompact(page)) {
      await page.getByRole("button", { name: "Pesanan" }).click();
      await page.getByRole("button", { name: /Nadia Putri/ }).click();
      await expect(page.getByRole("button", { name: "Pesanan" }).first()).toBeVisible();
    } else {
      if (!isWide(page)) {
        await page.getByRole("button", { name: "Tampilkan sidebar" }).click();
      }
      await page.getByRole("complementary", { name: "Menu" }).getByRole("button", { name: "Pesanan" }).click();
    }
    await expect(page.getByRole("heading", { name: "Nadia Putri", level: 1 })).toBeVisible();
    await expect(page.getByText("Butuh persetujuanmu").first()).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot("gallery-orders.png");
  });
});

test("safe area and no horizontal scroll", async ({ page }) => {
  await seedSeller(page);
  for (const host of ["landing", "app", STORE.slug]) {
    await open(page, host);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${host} scrolls horizontally`).toBeLessThanOrEqual(0);
  }
});
