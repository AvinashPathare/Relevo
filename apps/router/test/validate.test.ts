import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCsv } from "../src/validate.ts";

const sample = (f: string) => readFileSync(new URL(`../../../samples/${f}`, import.meta.url), "utf8");
const salt = (b: number) => () => new Uint8Array(32).fill(b);

describe("validateCsv", () => {
  it("builds a draft from the valid sample", () => {
    const r = validateCsv(sample("payees.csv"), "18.50", salt(1));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(5);
    expect(r.total_locked).toBe("9022500000");
    expect(r.draft?.amounts_usdc).toEqual([
      "2000000000",
      "2000000000",
      "1500000000",
      "2500000000",
      "1000000000",
    ]);
    expect(r.draft?.batch_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the hash depends on the salt", () => {
    const a = validateCsv(sample("payees.csv"), "18.50", salt(1)).draft?.batch_hash;
    const b = validateCsv(sample("payees.csv"), "18.50", salt(2)).draft?.batch_hash;
    expect(a).not.toBe(b);
  });
  it("blocks the batch on one bad row", () => {
    const r = validateCsv(sample("payees-with-error.csv"), "18.50", salt(1));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([{ row: 5, reason: "clabe_check_digit" }]);
    expect(r.draft).toBeUndefined();
  });
  it("never returns a full CLABE", () => {
    const r = validateCsv(sample("payees.csv"), "18.50", salt(1));
    const { draft, ...publicPart } = r;
    expect(JSON.stringify(publicPart)).not.toMatch(/\d{18}/);
    expect(publicPart.rows[0].clabe_last4).toBe("7771");
    expect(draft?.rows[0].clabe).toBe("002010077777777771"); // kept only in the local draft
  });
});
