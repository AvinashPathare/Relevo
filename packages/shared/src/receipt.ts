/**
 * Signed batch receipts: ed25519 over the RFC 8785 canonical JSON of the body.
 * The anchored hash is base58(sha256(canonical JSON of the whole signed receipt)).
 * Verification always takes the expected public key from outside the file.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { b58encode } from "./base58.ts";
import { type Ed25519Key, publicKeyFromString, sign, verify } from "./keys.ts";

import { LABEL } from "./label.ts";

export { LABEL };

export interface ReceiptPayout {
  id: number;
  amount_usdc: string;
  amount_mxn: string;
  payee_ref: string;
  clabe_last4: string;
  state: "Delivered" | "Refunded";
  excluded: boolean;
  reason: string | null;
  firms_tried: string[];
  final_firm: string | null;
  quote_bps: number;
  cutoff_ns: string;
  final_deadline_ns: string;
  delivered_at_ns: string | null;
  proof_ref: string | null;
  /** oracle's ed25519 signature (base64) over the delivery proof or exclusion */
  oracle_sig: string | null;
  assigned_at_ns: string | null;
  penalties_total: string;
  txs: Record<string, string[]>;
}

export interface ReceiptBody {
  version: "elivo-receipt-1";
  label: string;
  network: string;
  escrow: string;
  batch_id: string;
  batch_hash: string;
  funder: string;
  generated_at: string;
  payouts: ReceiptPayout[];
  totals: { locked: string; paid_to_firms: string; returned_to_funder: string; penalties: string };
}

export interface Receipt extends ReceiptBody {
  signature: { alg: "ed25519"; public_key: string; sig: string };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "key_mismatch" | "bad_signature" | "malformed" };

const canonicalBytes = (v: unknown) => Buffer.from(canonicalize(v) ?? "", "utf8");

export function signReceipt(body: ReceiptBody, key: Ed25519Key): Receipt {
  const sig = sign(key, canonicalBytes(body));
  return {
    ...body,
    signature: { alg: "ed25519", public_key: key.publicKeyStr, sig: Buffer.from(sig).toString("base64") },
  };
}

export function verifyReceipt(r: Receipt, expectedPublicKey: string): VerifyResult {
  if (!r || typeof r !== "object" || !r.signature || r.signature.alg !== "ed25519" || !r.version) {
    return { ok: false, reason: "malformed" };
  }
  if (r.signature.public_key !== expectedPublicKey) return { ok: false, reason: "key_mismatch" };
  const { signature, ...body } = r;
  let pub: Uint8Array;
  try {
    pub = publicKeyFromString(expectedPublicKey);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const ok = verify(pub, canonicalBytes(body), Buffer.from(signature.sig, "base64"));
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export function receiptHash(r: Receipt): Uint8Array {
  return new Uint8Array(createHash("sha256").update(canonicalBytes(r)).digest());
}

export function receiptHashB58(r: Receipt): string {
  return b58encode(receiptHash(r));
}
