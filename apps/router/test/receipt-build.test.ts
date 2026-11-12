import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BatchView, PayoutView } from "@elivo/shared/views";
import { describe, expect, it } from "vitest";
import { buildReceiptBody } from "../src/receipt-build.ts";
import { validateCsv } from "../src/validate.ts";

const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");
const draft = validateCsv(csv, "18.50", () => new Uint8Array(32).fill(1)).draft!;
draft.txs = { 0: { assign: ["t0"], settle: ["t1"] } };
draft.exclusion_reasons = { 2: "ACCOUNT_CLOSED" };
draft.oracle_sigs = { 0: "c2lnMA==", 2: "c2lnMg==" };
draft.assigned_at_ns = { 0: "10", 1: "11", 2: "12" };

const batch: BatchView = {
  id: "4",
  funder: "dao.test.near",
  batch_hash: draft.batch_hash,
  funded_at_ns: "1",
  payout_count: 3,
  router_id: "router.test.near",
  oracle_pk: "ed25519:x",
  receipt_pk: "ed25519:y",
  receipt_hash: null,
};
const base = {
  batch_id: "4",
  cutoff_ns: "100",
  final_deadline_ns: "900",
  proof_ref: null,
  delivered_at_ns: null,
};
const payouts: PayoutView[] = [
  {
    ...base,
    id: 0,
    amount: "2000000000",
    locked: "2005000000",
    state: "Delivered",
    firm: "mx2",
    quote_bps: 20,
    penalties_total: "0",
    firms_tried: ["mx2"],
    excluded: false,
    delivered_at_ns: "50",
    proof_ref: "CEP-SIM-4-0-aaaa",
  },
  {
    ...base,
    id: 1,
    amount: "2000000000",
    locked: "2005000000",
    state: "Delivered",
    firm: "mx2",
    quote_bps: 20,
    penalties_total: "2000",
    firms_tried: ["mx3", "mx2"],
    excluded: false,
    delivered_at_ns: "150",
    proof_ref: "CEP-SIM-4-1-bbbb",
  },
  {
    ...base,
    id: 2,
    amount: "1500000000",
    locked: "1503750000",
    state: "Refunded",
    firm: "mx2",
    quote_bps: 20,
    penalties_total: "0",
    firms_tried: ["mx2"],
    excluded: true,
  },
];

describe("buildReceiptBody", () => {
  const body = buildReceiptBody(
    draft,
    batch,
    payouts,
    "sandbox",
    "escrow.test.near",
    "2026-11-12T00:00:00.000Z",
  );

  it("computes totals from the views", () => {
    expect(body.totals).toEqual({
      locked: "5513750000",
      paid_to_firms: "4008000000",
      returned_to_funder: "1505752000",
      penalties: "2000",
    });
  });
  it("describes each payout without payee data", () => {
    expect(body.payouts[1]).toMatchObject({
      firms_tried: ["mx3", "mx2"],
      final_firm: "mx2",
      penalties_total: "2000",
      state: "Delivered",
    });
    expect(body.payouts[2]).toMatchObject({
      excluded: true,
      reason: "ACCOUNT_CLOSED",
      state: "Refunded",
      final_firm: null,
    });
    expect(body.payouts[0].txs).toEqual({ assign: ["t0"], settle: ["t1"] });
    expect(body.payouts[0].amount_mxn).toBe("37000.00");
    const expectedRef = createHash("sha256")
      .update(Buffer.concat([Buffer.from(draft.salt_hex, "hex"), Buffer.from("002010077777777771")]))
      .digest("hex");
    expect(body.payouts[0].payee_ref).toBe(expectedRef);
    expect(body.payouts[0].clabe_last4).toBe("7771");
    expect(JSON.stringify(body)).not.toMatch(/Lucía|002010077777777771/);
  });
  it("includes the oracle signature and assign time per payout (spec §8)", () => {
    expect(body.payouts[0]).toMatchObject({ oracle_sig: "c2lnMA==", assigned_at_ns: "10" });
    expect(body.payouts[2]).toMatchObject({ oracle_sig: "c2lnMg==", assigned_at_ns: "12" });
    expect(body.payouts[1]).toMatchObject({ oracle_sig: null, assigned_at_ns: "11" });
  });
  it("carries the label and batch identity", () => {
    expect(body.label).toMatch(/Testnet prototype/);
    expect(body).toMatchObject({
      batch_id: "4",
      funder: "dao.test.near",
      batch_hash: draft.batch_hash,
      escrow: "escrow.test.near",
    });
  });
});

describe("buildReceiptBody isolation", () => {
  it("is not changed by later tx records", () => {
    const b = buildReceiptBody(
      draft,
      batch,
      payouts,
      "sandbox",
      "escrow.test.near",
      "2026-11-12T00:00:00.000Z",
    );
    const before = JSON.stringify(b);
    draft.txs[0].settle.push("late-hash");
    draft.txs[1] = { assign: ["x"] };
    expect(JSON.stringify(b)).toBe(before);
  });
});
