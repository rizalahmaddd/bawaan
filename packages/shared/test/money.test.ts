import { describe, expect, it } from "vitest";
import { allocateProportionally, formatForeign, formatRupiah, itemPriceRupiah, parseKurs, toRupiah } from "../src";

describe("parseKurs", () => {
  it("accepts dot or comma decimals and thousand separators", () => {
    expect(parseKurs("105,25")).toBe(105_250_000n);
    expect(parseKurs("16.250")).toBe(16_250_000_000n);
    expect(parseKurs("0,000001")).toBe(1n);
  });
  it("rejects garbage", () => {
    expect(() => parseKurs("abc")).toThrow();
    expect(() => parseKurs("1,1234567")).toThrow();
  });
});

describe("toRupiah", () => {
  it("converts zero-decimal currencies", () => {
    expect(toRupiah(3200, "JPY", parseKurs("105,25"))).toBe(336_800);
  });
  it("converts two-decimal currencies from cents", () => {
    expect(toRupiah(1999, "USD", parseKurs("16250"))).toBe(324_838);
  });
  it("always rounds up, then to the step", () => {
    expect(toRupiah(1, "JPY", parseKurs("105,1"))).toBe(106);
    expect(toRupiah(3200, "JPY", parseKurs("105,25"), 1000)).toBe(337_000);
    expect(toRupiah(3200, "JPY", parseKurs("105,25"), 500)).toBe(337_000);
    expect(toRupiah(0, "JPY", parseKurs("105"), 1000)).toBe(0);
  });
  it("rejects fractional minor units", () => {
    expect(() => toRupiah(1.5, "JPY", 1n)).toThrow();
  });
});

describe("itemPriceRupiah", () => {
  it("adds the jastip fee after conversion", () => {
    expect(itemPriceRupiah({ priceMinor: 3200, currency: "JPY", kursMicro: parseKurs("105,25"), feeRupiah: 25_000, rounding: 1000 })).toBe(362_000);
  });
  it("passes IDR through", () => {
    expect(itemPriceRupiah({ priceMinor: 100_000, currency: "IDR", kursMicro: 0n, feeRupiah: 5_000 })).toBe(105_000);
  });
});

describe("formatting", () => {
  it("formats rupiah without decimals", () => {
    expect(formatRupiah(1_250_317)).toBe("Rp\u00a01.250.317");
    expect(formatRupiah(-5_000)).toBe("-Rp\u00a05.000");
    expect(formatRupiah(0)).toBe("Rp\u00a00");
  });
  it("formats foreign amounts from minor units", () => {
    expect(formatForeign(1999, "USD")).toContain("19,99");
    expect(formatForeign(3200, "JPY")).toContain("3.200");
  });
});

describe("allocateProportionally", () => {
  it("sums exactly to the total", () => {
    const parts = allocateProportionally(100_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
    expect(parts).toEqual([33_334, 33_333, 33_333]);
  });
  it("follows weights", () => {
    expect(allocateProportionally(90_000, [1200, 600, 0])).toEqual([60_000, 30_000, 0]);
  });
  it("handles zero weights", () => {
    expect(allocateProportionally(5, [0, 0])).toEqual([0, 0]);
  });
});
