/**
 * Browser-safe receipt checks (WebCrypto, no Node built-ins): the same verdicts and anchored hash as
 * receipt.ts, which the tests pin on every published vector. Used by the web app's /verify page.
 */
import canonicalize from "canonicalize";
import { b58decode, b58encode } from "./base58.ts";
import { lockedFor } from "./money.ts";
import type { Receipt, VerifyResult } from "./receipt.ts";

const canonicalBytes = (v: unknown) => new TextEncoder().encode(canonicalize(v) ?? "");

function fromBase64(s: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Raw 32-byte key from "ed25519:<base58>", or null. */
function rawKey(pk: string): Uint8Array | null {
  if (!pk.startsWith("ed25519:")) return null;
  try {
    const k = b58decode(pk.slice("ed25519:".length));
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

export async function verifyReceiptWeb(r: unknown, expectedPk: string): Promise<VerifyResult> {
  const rec = r as Receipt | null;
  if (!rec || typeof rec !== "object" || !rec.signature || rec.signature.alg !== "ed25519" || !rec.version)
    return { ok: false, reason: "malformed" };
  if (rec.signature.public_key !== expectedPk) return { ok: false, reason: "key_mismatch" };
  const raw = rawKey(expectedPk);
  const sig = typeof rec.signature.sig === "string" ? fromBase64(rec.signature.sig) : null;
  // An ed25519 signature is 64 bytes; some WebCrypto builds throw on anything else instead of saying no.
  if (!raw || !sig || sig.length !== 64) return { ok: false, reason: "malformed" };
  const { signature: _s, ...body } = rec;
  try {
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, canonicalBytes(body));
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** base58(sha256(canonical JSON of the whole signed receipt)): the hash the escrow anchors. */
export async function receiptHashB58Web(r: Receipt): Promise<string> {
  return b58encode(new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBytes(r))));
}

/**
 * Totals recomputed from the rows, by the router's rules: locked = Σ amount + fee buffer; paid to firms
 * = Σ delivered amount + its fee; returned to the funder = locked − paid + penalties. Returns the names
 * of the totals that differ (empty when everything adds up).
 */
export function totalsProblems(r: Receipt): string[] {
  let locked = 0n;
  let paid = 0n;
  let penalties = 0n;
  for (const p of r.payouts) {
    const amount = BigInt(p.amount_usdc);
    locked += lockedFor(amount);
    penalties += BigInt(p.penalties_total);
    if (p.state === "Delivered") paid += amount + (amount * BigInt(p.quote_bps)) / 10_000n;
  }
  const want: Record<string, bigint> = {
    locked,
    paid_to_firms: paid,
    returned_to_funder: locked - paid + penalties,
    penalties,
  };
  return Object.entries(want)
    .filter(([k, v]) => r.totals?.[k as keyof Receipt["totals"]] !== v.toString())
    .map(([k]) => k);
}
