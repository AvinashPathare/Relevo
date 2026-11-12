import { describe, expect, it } from "vitest";
import { b58decode, b58encode } from "../src/base58.ts";
import { keyFromSeed } from "../src/keys.ts";
import {
  type Receipt,
  type ReceiptBody,
  receiptHashB58,
  signReceipt,
  verifyReceipt,
} from "../src/receipt.ts";
import { receiptHashB58Web, totalsProblems, verifyReceiptWeb } from "../src/receipt-web.ts";

const key = keyFromSeed(new Uint8Array(32).fill(3));
const other = keyFromSeed(new Uint8Array(32).fill(4));

const row = (
  id: number,
  over: Partial<ReceiptBody["payouts"][number]> = {},
): ReceiptBody["payouts"][number] => ({
  id,
  amount_usdc: "1000000000",
  amount_mxn: "18500.00",
  payee_ref: "cd".repeat(32),
  clabe_last4: "7771",
  state: "Delivered",
  excluded: false,
  reason: null,
  firms_tried: ["mx1.t"],
  final_firm: "mx1.t",
  quote_bps: 20,
  cutoff_ns: "1",
  final_deadline_ns: "2",
  delivered_at_ns: "1",
  proof_ref: "CEP-SIM-0-0-abcd",
  oracle_sig: "c2ln",
  assigned_at_ns: "1",
  penalties_total: "0",
  txs: { assign: ["H1"], settle: ["H2"] },
  ...over,
});

/** Two payouts: one delivered at 20 bps, one refunded after a 0.3 USDC penalty. */
function body(): ReceiptBody {
  return {
    version: "elivo-receipt-1",
    label: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.",
    network: "sandbox",
    escrow: "escrow.t",
    batch_id: "0",
    batch_hash: "ab".repeat(32),
    funder: "dao.t",
    generated_at: "2026-11-12T10:00:00.000Z",
    payouts: [
      row(0),
      row(1, {
        state: "Refunded",
        final_firm: null,
        delivered_at_ns: null,
        proof_ref: null,
        oracle_sig: null,
        penalties_total: "300000",
        txs: { refund: ["H3"] },
      }),
    ],
    // locked = 2 × (1000 + 25 bps fee buffer) = 2005; paid = 1000 + 20 bps = 1002; returned = 2005 − 1002 + 0.3
    totals: {
      locked: "2005000000",
      paid_to_firms: "1002000000",
      returned_to_funder: "1003300000",
      penalties: "300000",
    },
  };
}

const signed = () => signReceipt(body(), key);

describe("verifyReceiptWeb agrees with the Node verifier", () => {
  const cases: Array<[string, () => unknown, string]> = [
    ["valid", signed, key.publicKeyStr],
    [
      "edited amount",
      () => {
        const r = signed();
        r.payouts[0].amount_usdc = "9000000000";
        return r;
      },
      key.publicKeyStr,
    ],
    ["wrong key", signed, other.publicKeyStr],
    [
      "missing signature",
      () => {
        const { signature: _s, ...rest } = signed();
        return rest;
      },
      key.publicKeyStr,
    ],
    ["not an object", () => "nope", key.publicKeyStr],
  ];
  for (const [name, make, pk] of cases)
    it(name, async () => {
      const r = make();
      expect(await verifyReceiptWeb(r, pk)).toEqual(verifyReceipt(r as Receipt, pk));
    });

  it("computes the same anchored hash", async () => {
    const r = signed();
    expect(await receiptHashB58Web(r)).toBe(receiptHashB58(r));
  });
});

describe("totalsProblems", () => {
  it("is empty when every total adds up from the rows", () => {
    expect(totalsProblems(signed())).toEqual([]);
  });
  it("names each total that does not add up", () => {
    const r = signed();
    r.totals.paid_to_firms = "1";
    expect(totalsProblems(r)).toEqual(["paid_to_firms"]);
  });
});

describe("base58 without Buffer", () => {
  it("round-trips, keeping leading zero bytes", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255, 128]);
    expect(b58decode(b58encode(bytes))).toEqual(bytes);
    expect(b58encode(new Uint8Array(0))).toBe("");
  });
});
