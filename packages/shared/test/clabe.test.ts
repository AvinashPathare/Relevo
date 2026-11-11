import { describe, expect, it } from "vitest";
import { clabeCheckDigit, clabeLast4, validateClabe } from "../src/clabe.ts";

describe("CLABE", () => {
  it("computes the check digit for published examples", () => {
    expect(clabeCheckDigit("00201007777777777")).toBe(1);
    expect(clabeCheckDigit("03218000011835971")).toBe(9);
  });
  it("accepts a valid CLABE", () => {
    expect(validateClabe("002010077777777771")).toEqual({ ok: true });
  });
  it("rejects a wrong check digit", () => {
    expect(validateClabe("002010077777777772")).toEqual({ ok: false, reason: "clabe_check_digit" });
  });
  it("rejects wrong length and non-digits", () => {
    expect(validateClabe("12345")).toEqual({ ok: false, reason: "clabe_length" });
    expect(validateClabe("00201007777777777a")).toEqual({ ok: false, reason: "clabe_non_digit" });
  });
  it("shows only the last four digits", () => {
    expect(clabeLast4("002010077777777771")).toBe("7771");
  });
});
