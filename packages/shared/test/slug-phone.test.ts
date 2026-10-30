import { describe, expect, it } from "vitest";
import { checkSlug, maskPhone, normalizePhone, suggestSlug, waLink } from "../src";

describe("checkSlug", () => {
  it.each(["jastipjepang", "toko-ayu", "abc", "a1b2c3"])("accepts %s", (s) => {
    expect(checkSlug(s).ok).toBe(true);
  });
  it("lowercases", () => {
    expect(checkSlug("TokoAyu")).toEqual({ ok: true, slug: "tokoayu" });
  });
  it.each([
    ["ab", "Minimal"],
    ["-toko", "diawali"],
    ["toko-", "diawali"],
    ["to--ko", "--"],
    ["toko_ayu", "Hanya"],
    ["xn-toko", "tidak bisa"],
    ["app", "sistem"],
    ["promo-bca", "merek"],
    ["gopay-murah", "merek"],
    ["a".repeat(31), "Maksimal"],
  ])("rejects %s", (s, msg) => {
    const r = checkSlug(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(msg);
  });
});

describe("suggestSlug", () => {
  it("builds a slug from a store name", () => {
    expect(suggestSlug("Jastip Ayu — Jepang & Korea!")).toBe("jastip-ayu-jepang-korea");
    expect(suggestSlug("Café Señora")).toBe("cafe-senora");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["0812-3456-7890", "+6281234567890"],
    ["+62 812 3456 7890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["81234567890", "+6281234567890"],
    ["+62 0812 3456 7890", "+6281234567890"],
    ["+81 90-1234-5678", "+819012345678"],
  ])("%s → %s", (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });
  it.each(["", "abc", "0212345678", "08123"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("phone helpers", () => {
  it("masks", () => expect(maskPhone("+6281234567890")).toBe("+6281•••890"));
  it("builds wa.me links", () => {
    expect(waLink("+6281234567890", "Halo Kak")).toBe("https://wa.me/6281234567890?text=Halo%20Kak");
  });
});

describe("isSlugShape agrees with the zod format rules", () => {
  it.each(["abc", "toko-ayu", "a1", "ab", "-x", "x-", "a--b", "xn-abc", "a".repeat(30), "a".repeat(31), "Toko"])("%s", async (s) => {
    const { isSlugShape, slugFormatSchema } = await import("../src/slug");
    const viaZod = slugFormatSchema.safeParse(s);
    expect(isSlugShape(s)).toBe(viaZod.success && viaZod.data === s);
  });
});
