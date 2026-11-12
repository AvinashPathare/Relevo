/**
 * Test vectors for elivo-receipt-1 (docs/receipts/vectors). Deterministic: a fixed seed key and a fixed
 * generated_at, so regenerating gives byte-identical files. Tests pin each vector's verdict and hash.
 */
import { keyFromSeed } from "@elivo/shared/keys";
import { LABEL, type Receipt, type ReceiptBody, receiptHashB58, signReceipt } from "@elivo/shared/receipt";

export interface VectorEntry {
  file: string;
  description: string;
  /** The key a verifier must be given (in a real check, the batch's on-chain receipt_pk). */
  public_key: string;
  expect: "ok" | "bad_signature" | "key_mismatch" | "malformed";
  /** base58(sha256(canonical JSON)) of the file, as anchored on-chain; null when malformed. */
  receipt_hash: string | null;
}

export const SIGNING_KEY = keyFromSeed(new Uint8Array(32).fill(9));
export const OTHER_KEY = keyFromSeed(new Uint8Array(32).fill(10));

/** Three payouts: on time; late, rerouted, with a penalty; account closed and refunded. */
export function vectorBody(): ReceiptBody {
  const tx = (c: string) => c.repeat(44);
  return {
    version: "elivo-receipt-1",
    label: LABEL,
    network: "testnet",
    escrow: "escrow.example.testnet",
    batch_id: "7",
    batch_hash: "5f".repeat(32),
    funder: "dao.example.testnet",
    generated_at: "2026-11-12T12:00:00.000Z",
    payouts: [
      {
        id: 0,
        amount_usdc: "1000000000",
        amount_mxn: "18500.00",
        payee_ref: "a1".repeat(32),
        clabe_last4: "7771",
        state: "Delivered",
        excluded: false,
        reason: null,
        firms_tried: ["mx1.example.testnet"],
        final_firm: "mx1.example.testnet",
        quote_bps: 20,
        cutoff_ns: "1794420000000000000",
        final_deadline_ns: "1794420300000000000",
        delivered_at_ns: "1794419990000000000",
        proof_ref: "CEP-SIM-7-0-0001",
        oracle_sig: null,
        assigned_at_ns: "1794419900000000000",
        penalties_total: "0",
        txs: { assign: [tx("A")], settle: [tx("B")] },
      },
      {
        id: 1,
        amount_usdc: "2000000000",
        amount_mxn: "37000.00",
        payee_ref: "b2".repeat(32),
        clabe_last4: "9719",
        state: "Delivered",
        excluded: false,
        reason: null,
        firms_tried: ["mx3.example.testnet", "mx2.example.testnet"],
        final_firm: "mx2.example.testnet",
        quote_bps: 20,
        cutoff_ns: "1794420060000000000",
        final_deadline_ns: "1794420300000000000",
        delivered_at_ns: "1794420050000000000",
        proof_ref: "CEP-SIM-7-1-0002",
        oracle_sig: null,
        assigned_at_ns: "1794419900000000000",
        penalties_total: "400000",
        txs: { assign: [tx("C")], reroute: [tx("D")], settle: [tx("E")] },
      },
      {
        id: 2,
        amount_usdc: "500000000",
        amount_mxn: "9250.00",
        payee_ref: "c3".repeat(32),
        clabe_last4: "0004",
        state: "Refunded",
        excluded: true,
        reason: "ACCOUNT_CLOSED",
        firms_tried: ["mx2.example.testnet"],
        final_firm: null,
        quote_bps: 20,
        cutoff_ns: "1794420000000000000",
        final_deadline_ns: "1794420300000000000",
        delivered_at_ns: null,
        proof_ref: null,
        oracle_sig: null,
        assigned_at_ns: "1794419900000000000",
        penalties_total: "0",
        txs: { assign: [tx("F")], exclude: [tx("G")], refund: [tx("H")] },
      },
    ],
    // locked = 3500 + 25 bps = 3508.75; paid = 1002 + 2004 = 3006; returned = 3508.75 − 3006 + 0.4
    totals: {
      locked: "3508750000",
      paid_to_firms: "3006000000",
      returned_to_funder: "503150000",
      penalties: "400000",
    },
  };
}

/** Each vector's file name → JSON text, plus the manifest. */
export function buildVectors(): { files: Record<string, string>; manifest: VectorEntry[] } {
  const valid = signReceipt(vectorBody(), SIGNING_KEY);
  const edited: Receipt = structuredClone(valid);
  edited.payouts[1].amount_usdc = "2500000000";
  const { signature: _s, ...unsigned } = valid;
  const pk = SIGNING_KEY.publicKeyStr;
  const entries: Array<[VectorEntry, unknown]> = [
    [
      {
        file: "valid.json",
        description: "A genuine receipt: verify with the signing key.",
        public_key: pk,
        expect: "ok",
        receipt_hash: receiptHashB58(valid),
      },
      valid,
    ],
    [
      {
        file: "edited-amount.json",
        description: "valid.json with payout 1's amount_usdc changed after signing.",
        public_key: pk,
        expect: "bad_signature",
        receipt_hash: receiptHashB58(edited),
      },
      edited,
    ],
    [
      {
        file: "valid.json",
        description: "valid.json checked against a key that is not the batch's receipt key.",
        public_key: OTHER_KEY.publicKeyStr,
        expect: "key_mismatch",
        receipt_hash: receiptHashB58(valid),
      },
      valid,
    ],
    [
      {
        file: "unsigned.json",
        description: "valid.json with the signature removed.",
        public_key: pk,
        expect: "malformed",
        receipt_hash: null,
      },
      unsigned,
    ],
  ];
  const files: Record<string, string> = {};
  for (const [e, content] of entries) files[e.file] = `${JSON.stringify(content, null, 2)}\n`;
  const manifest = entries.map(([e]) => e);
  files["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { files, manifest };
}
