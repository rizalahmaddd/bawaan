import { describe, expect, it } from "vitest";
import { qrisCrc, qrisMerchantName, qrisWithAmount } from "../src/qris";

const STATIC =
  "00020101021126570011ID.DANA.WWW011893600915393002264102099300226410303UMI51440014ID.CO.QRIS.WWW0215ID10254105692850303UMI5204511153033605802ID5911RZ Printing6011Kab. Malang61056515863049A39";

describe("qris", () => {
  it("validates the static payload checksum", () => {
    expect(qrisCrc(STATIC.slice(0, -4))).toBe("9A39");
    expect(qrisMerchantName(STATIC)).toBe("RZ Printing");
  });

  it("makes a dynamic QRIS with the amount", () => {
    const out = qrisWithAmount(STATIC, 49_000);
    expect(out).toContain("010212");
    expect(out).not.toContain("010211");
    expect(out).toContain("53033605405490005802ID");
    expect(qrisCrc(out.slice(0, -4))).toBe(out.slice(-4));
    expect(qrisWithAmount(out, 147_000)).toContain("5406147000");
  });

  it("rejects a corrupted payload", () => {
    expect(() => qrisWithAmount(STATIC.slice(0, -4) + "0000", 49_000)).toThrow();
    expect(() => qrisWithAmount(STATIC, 0)).toThrow();
  });
});
