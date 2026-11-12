import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildVectors } from "../../../scripts/lib/receipt-vectors.ts";
import { type Receipt, receiptHashB58, verifyReceipt } from "../src/receipt.ts";
import { receiptHashB58Web, totalsProblems, verifyReceiptWeb } from "../src/receipt-web.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const schema = JSON.parse(read("docs/receipts/elivo-receipt-1.schema.json"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const manifest = JSON.parse(read("docs/receipts/vectors/manifest.json")) as ReturnType<
  typeof buildVectors
>["manifest"];
const vector = (file: string) => JSON.parse(read(`docs/receipts/vectors/${file}`)) as Receipt;
const verdict = (v: { ok: boolean; reason?: string }) => (v.ok ? "ok" : v.reason);

describe("elivo-receipt-1 schema", () => {
  it("accepts every signed vector and the testnet reference receipt", () => {
    for (const f of ["valid.json", "edited-amount.json"]) expect(validate(vector(f)), f).toBe(true);
    const ref = JSON.parse(read("apps/web/public/receipts/testnet-batch-5.json"));
    expect(validate(ref), JSON.stringify(validate.errors)).toBe(true);
  });
  it("rejects a receipt without a signature, or with an extra field", () => {
    expect(validate(vector("unsigned.json"))).toBe(false);
    expect(validate({ ...vector("valid.json"), note: "x" })).toBe(false);
  });
});

describe("test vectors", () => {
  it("are what the generator produces, byte for byte", () => {
    for (const [name, text] of Object.entries(buildVectors().files))
      expect(read(`docs/receipts/vectors/${name}`), name).toBe(text);
  });
  for (const e of manifest)
    it(`${e.file} with ${e.public_key.slice(0, 16)}… → ${e.expect}`, async () => {
      const r = vector(e.file);
      expect(verdict(verifyReceipt(r, e.public_key))).toBe(e.expect);
      expect(verdict(await verifyReceiptWeb(r, e.public_key))).toBe(e.expect);
      if (e.receipt_hash) {
        expect(receiptHashB58(r)).toBe(e.receipt_hash);
        expect(await receiptHashB58Web(r)).toBe(e.receipt_hash);
      }
    });
  it("valid.json's totals add up from its rows", () => {
    expect(totalsProblems(vector("valid.json"))).toEqual([]);
  });
});
