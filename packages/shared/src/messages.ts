/**
 * Domain-separated signed messages: borsh((domain, escrow_id, payload)).
 * Byte-identical to the contract (contracts/escrow/src/signing.rs, vectors in tests/fixtures).
 */
import { randomBytes } from "node:crypto";

export const QUOTE_DOMAIN = "elivo-quote-v1";
export const PROOF_DOMAIN = "elivo-proof-v1";
export const EXCLUSION_DOMAIN = "elivo-exclusion-v1";
export const REASON_ACCOUNT_CLOSED = 1;

export interface Quote {
  batch_id: bigint;
  payout_id: number;
  firm_id: string;
  quote_bps: number;
}
export interface DeliveryProof {
  batch_id: bigint;
  payout_id: number;
  firm_id: string;
  delivered_at_ns: bigint;
  proof_ref: string;
  nonce: bigint;
}
export interface Exclusion {
  batch_id: bigint;
  payout_id: number;
  firm_id: string;
  reason_code: number;
  observed_at_ns: bigint;
  nonce: bigint;
}

class Writer {
  private parts: Buffer[] = [];
  u8(n: number) {
    this.parts.push(Buffer.from([n]));
    return this;
  }
  u16(n: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    this.parts.push(b);
    return this;
  }
  u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    this.parts.push(b);
    return this;
  }
  u64(n: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    this.parts.push(b);
    return this;
  }
  str(s: string) {
    const bytes = Buffer.from(s, "utf8");
    return this.u32(bytes.length).raw(bytes);
  }
  raw(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  done(): Uint8Array {
    return new Uint8Array(Buffer.concat(this.parts));
  }
}

const head = (domain: string, escrowId: string) => new Writer().str(domain).str(escrowId);

export function quoteMessage(escrowId: string, q: Quote): Uint8Array {
  return head(QUOTE_DOMAIN, escrowId).u64(q.batch_id).u32(q.payout_id).str(q.firm_id).u16(q.quote_bps).done();
}

export function proofMessage(escrowId: string, p: DeliveryProof): Uint8Array {
  return head(PROOF_DOMAIN, escrowId)
    .u64(p.batch_id)
    .u32(p.payout_id)
    .str(p.firm_id)
    .u64(p.delivered_at_ns)
    .str(p.proof_ref)
    .u64(p.nonce)
    .done();
}

export function exclusionMessage(escrowId: string, x: Exclusion): Uint8Array {
  return head(EXCLUSION_DOMAIN, escrowId)
    .u64(x.batch_id)
    .u32(x.payout_id)
    .str(x.firm_id)
    .u8(x.reason_code)
    .u64(x.observed_at_ns)
    .u64(x.nonce)
    .done();
}

/** The contract's `DeliveryProofJson` (u64 fields as strings). */
export function proofToJson(p: DeliveryProof) {
  return {
    batch_id: p.batch_id.toString(),
    payout_id: p.payout_id,
    firm_id: p.firm_id,
    delivered_at_ns: p.delivered_at_ns.toString(),
    proof_ref: p.proof_ref,
    nonce: p.nonce.toString(),
  };
}

/** The contract's `ExclusionJson`. */
export function exclusionToJson(x: Exclusion) {
  return {
    batch_id: x.batch_id.toString(),
    payout_id: x.payout_id,
    firm_id: x.firm_id,
    reason_code: x.reason_code,
    observed_at_ns: x.observed_at_ns.toString(),
    nonce: x.nonce.toString(),
  };
}

/** Random 63-bit nonce; the oracle keeps nonces unique across settle and exclude. */
export function randomNonce(): bigint {
  return randomBytes(8).readBigUInt64LE() & 0x7fff_ffff_ffff_ffffn;
}
