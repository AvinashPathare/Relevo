import { describe, expect, it } from "vitest";
import { buildVectors, OTHER_KEY, SIGNING_KEY } from "../../../scripts/lib/receipt-vectors.ts";
import { verifyAgainstChain } from "../lib/verify.ts";

const { files, manifest } = buildVectors();
const VALID = files["valid.json"];
const HASH = manifest[0].receipt_hash as string;
const app = { escrow: "escrow.example.testnet", network: "testnet" };

/** A chain where batch 7 exists with the given receipt key and anchored hash. */
function chain(
  batch: { receipt_pk: string; receipt_hash: string | null } | null = {
    receipt_pk: SIGNING_KEY.publicKeyStr,
    receipt_hash: HASH,
  },
) {
  const calls: Array<{ contract: string; method: string; args?: object }> = [];
  const view = async <T>(contract: string, method: string, args?: object): Promise<T> => {
    calls.push({ contract, method, args });
    if (method === "get_batch") return batch as T;
    throw new Error(method);
  };
  return { view, calls };
}
const byId = (r: Awaited<ReturnType<typeof verifyAgainstChain>>) =>
  Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe("verifyAgainstChain", () => {
  it("passes all four checks for a genuine, anchored receipt, reading the key from the chain", async () => {
    const c = chain();
    const r = await verifyAgainstChain(VALID, app, c.view);
    expect(r.ok).toBe(true);
    expect(r.checks.map((x) => [x.id, x.ok])).toEqual([
      ["escrow", true],
      ["signature", true],
      ["anchor", true],
      ["totals", true],
    ]);
    expect(r.hash).toBe(HASH);
    expect(c.calls).toEqual([{ contract: app.escrow, method: "get_batch", args: { batch_id: "7" } }]);
  });

  it("fails the signature for a receipt edited after signing", async () => {
    const r = await verifyAgainstChain(files["edited-amount.json"], app, chain().view);
    expect(r.ok).toBe(false);
    expect(byId(r).signature).toMatchObject({
      ok: false,
      detail: "The signature does not match the contents: the file was changed after signing",
    });
  });

  it("fails the escrow check for a receipt from another escrow, without reading the chain", async () => {
    const c = chain();
    const r = await verifyAgainstChain(VALID, { escrow: "escrow.other.testnet", network: "testnet" }, c.view);
    expect(r.ok).toBe(false);
    expect(byId(r).escrow).toMatchObject({
      ok: false,
      detail:
        "This receipt is for escrow.example.testnet on testnet; this app checks escrow.other.testnet on testnet",
    });
    expect(c.calls).toHaveLength(0);
  });

  it("fails the signature when the file's key is not the batch's on-chain receipt key", async () => {
    const r = await verifyAgainstChain(
      VALID,
      app,
      chain({ receipt_pk: OTHER_KEY.publicKeyStr, receipt_hash: HASH }).view,
    );
    expect(byId(r).signature).toMatchObject({
      ok: false,
      detail: `Signed by ${SIGNING_KEY.publicKeyStr}, but the batch's receipt key on-chain is ${OTHER_KEY.publicKeyStr}`,
    });
  });

  it("reports a file that is not a receipt as one failing check, without reading the chain", async () => {
    for (const input of ["not json", "{}", JSON.stringify({ ...JSON.parse(VALID), batch_id: "abc" })]) {
      const c = chain();
      const r = await verifyAgainstChain(input, app, c.view);
      expect(r).toMatchObject({ ok: false, receipt: null, hash: null });
      expect(r.checks).toEqual([{ id: "format", ok: false, detail: "Not an elivo-receipt-1 file" }]);
      expect(c.calls).toHaveLength(0);
    }
  });

  it("fails the signature for an unsigned file", async () => {
    const r = await verifyAgainstChain(files["unsigned.json"], app, chain().view);
    expect(byId(r).signature).toMatchObject({ ok: false, detail: "No valid signature in the file" });
  });

  it("fails the anchor while the escrow has no receipt hash yet", async () => {
    const r = await verifyAgainstChain(
      VALID,
      app,
      chain({ receipt_pk: SIGNING_KEY.publicKeyStr, receipt_hash: null }).view,
    );
    expect(byId(r).signature.ok).toBe(true);
    expect(byId(r).anchor).toMatchObject({
      ok: false,
      detail: "Not anchored yet: the escrow has no receipt hash for batch 7",
    });
    expect(r.ok).toBe(false);
  });

  it("fails the anchor for a batch the escrow does not have", async () => {
    const r = await verifyAgainstChain(VALID, app, chain(null).view);
    expect(byId(r).anchor).toMatchObject({ ok: false, detail: "No batch 7 on escrow.example.testnet" });
    expect(r.ok).toBe(false);
  });

  it("fails the totals when one was edited (signature aside)", async () => {
    const edited = JSON.parse(VALID);
    edited.totals.penalties = "0";
    const r = await verifyAgainstChain(JSON.stringify(edited), app, chain().view);
    expect(byId(r).totals).toMatchObject({
      ok: false,
      detail: "These totals don't add up from the rows: penalties",
    });
  });
});
