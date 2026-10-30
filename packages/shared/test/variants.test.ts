import { describe, expect, it } from "vitest";
import { splitVariants } from "../src/variants";

describe("splitVariants", () => {
  it("splits on commas", () => {
    expect(splitVariants("S, M, L")).toEqual(["S", "M", "L"]);
    expect(splitVariants("S,M,,L, ")).toEqual(["S", "M", "L"]);
    expect(splitVariants("36, 37, 38")).toEqual(["36", "37", "38"]);
    expect(splitVariants("36,37,38")).toEqual(["36", "37", "38"]);
  });

  it("keeps decimal commas inside a variant", () => {
    expect(splitVariants("0,38 mm, 0,5 mm")).toEqual(["0,38 mm", "0,5 mm"]);
    expect(splitVariants("Botol 1,5 L,Botol 600 ml")).toEqual(["Botol 1,5 L", "Botol 600 ml"]);
  });
});
