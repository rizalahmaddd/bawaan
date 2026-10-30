import { describe, expect, it } from "vitest";
import { cargoCharge, roundWeightUp, volumetricG } from "../src/cargo";

describe("cargo", () => {
  it("rounds weight up to the forwarder step", () => {
    expect(roundWeightUp(0, 100)).toBe(0);
    expect(roundWeightUp(1, 100)).toBe(100);
    expect(roundWeightUp(1250, 100)).toBe(1300);
    expect(roundWeightUp(1250, 1000)).toBe(2000);
    expect(roundWeightUp(2000, 1000)).toBe(2000);
  });

  it("computes volumetric weight in grams", () => {
    expect(volumetricG({ lengthCm: 30, widthCm: 20, heightCm: 10 })).toBe(1000);
    expect(volumetricG({ lengthCm: 30, widthCm: 20 })).toBe(0);
  });

  it("bills the larger of actual and volumetric, with a minimum", () => {
    const rule = { ratePerKg: 150_000, roundG: 100, minIdr: 50_000 };
    expect(cargoCharge(rule, 1230)).toEqual({ chargeableG: 1230, billedG: 1300, volumetric: false, amount: 195_000 });
    expect(cargoCharge(rule, 200, { lengthCm: 40, widthCm: 30, heightCm: 20 })).toMatchObject({ chargeableG: 4000, billedG: 4000, volumetric: true, amount: 600_000 });
    expect(cargoCharge(rule, 100).amount).toBe(50_000);
    expect(cargoCharge(rule, 0).amount).toBe(0);
  });
});
