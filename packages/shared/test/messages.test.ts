import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyFromSecret, keyFromSeed, sign, verify } from "../src/keys.ts";
import { exclusionMessage, proofMessage, quoteMessage, randomNonce } from "../src/messages.ts";

interface Vector {
  domain: string;
  escrow_id: string;
  payload: Record<string, string | number>;
  message_hex: string;
  seed_hex: string;
  public_key_b58: string;
  signature_hex: string;
}
const vectors: Vector[] = JSON.parse(
  readFileSync(
    new URL("../../../contracts/escrow/tests/fixtures/signing-vectors.json", import.meta.url),
    "utf8",
  ),
);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function build(v: Vector): Uint8Array {
  const p = v.payload;
  const base = {
    batch_id: BigInt(p.batch_id as string),
    payout_id: Number(p.payout_id),
    firm_id: String(p.firm_id),
  };
  if (v.domain === "elivo-quote-v1")
    return quoteMessage(v.escrow_id, { ...base, quote_bps: Number(p.quote_bps) });
  if (v.domain === "elivo-proof-v1")
    return proofMessage(v.escrow_id, {
      ...base,
      delivered_at_ns: BigInt(p.delivered_at_ns as string),
      proof_ref: String(p.proof_ref),
      nonce: BigInt(p.nonce as string),
    });
  return exclusionMessage(v.escrow_id, {
    ...base,
    reason_code: Number(p.reason_code),
    observed_at_ns: BigInt(p.observed_at_ns as string),
    nonce: BigInt(p.nonce as string),
  });
}

describe("signed messages match the contract's vectors", () => {
  it("has the three vectors", () => expect(vectors.map((v) => v.domain)).toHaveLength(3));
  for (const v of vectors) {
    it(`${v.domain}: bytes, key and signature are identical`, () => {
      const msg = build(v);
      expect(hex(msg)).toBe(v.message_hex);
      const key = keyFromSeed(Buffer.from(v.seed_hex, "hex"));
      expect(key.publicKeyStr).toBe(`ed25519:${v.public_key_b58}`);
      const sig = sign(key, msg);
      expect(hex(sig)).toBe(v.signature_hex);
      expect(verify(key.publicKey, msg, sig)).toBe(true);
      const bad = Uint8Array.from(sig);
      bad[3] ^= 1;
      expect(verify(key.publicKey, msg, bad)).toBe(false);
    });
  }
});

describe("keys", () => {
  it("round-trips the NEAR secret key format", () => {
    const k = keyFromSeed(new Uint8Array(32).fill(9));
    const back = keyFromSecret(k.secretKeyStr);
    expect(back.publicKeyStr).toBe(k.publicKeyStr);
    expect(hex(back.seed)).toBe(hex(k.seed));
  });
  it("rejects non-ed25519 keys", () => {
    expect(() => keyFromSecret("secp256k1:abc")).toThrow();
  });
});

describe("nonces", () => {
  it("are 63-bit and distinct", () => {
    const set = new Set(Array.from({ length: 1000 }, () => randomNonce()));
    expect(set.size).toBe(1000);
    for (const n of set) expect(n >= 0n && n < 2n ** 63n).toBe(true);
  });
});
