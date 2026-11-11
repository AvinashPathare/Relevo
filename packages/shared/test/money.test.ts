import { describe, expect, it } from "vitest";
import { formatUsdc, lockedFor, mxnToUsdcUnits } from "../src/money.ts";

describe("money", () => {
  it("converts MXN to USDC base units at the fixed rate", () => {
    expect(mxnToUsdcUnits("37000.00", "18.50")).toBe(2_000_000_000n);
    expect(mxnToUsdcUnits("27750", "18.50")).toBe(1_500_000_000n);
  });
  it("rounds down", () => {
    expect(mxnToUsdcUnits("10.00", "18.50")).toBe(540_540n);
  });
  it("adds the 25 bps fee buffer, rounding down like the contract", () => {
    expect(lockedFor(1_000_001n)).toBe(1_002_501n);
    expect(lockedFor(2_000_000_000n)).toBe(2_005_000_000n);
  });
  it("formats USDC", () => {
    expect(formatUsdc(2_000_000_000n)).toBe("2,000.00");
    expect(formatUsdc(540_540n)).toBe("0.54");
  });
});
