/**
 * Checks a receipt file against the chain, in the browser. Everything that decides the verdict comes
 * from outside the file: the escrow and network from this app's config, the key and anchored hash from
 * the escrow's get_batch. Returns each check that ran, in order; it stops early when continuing would
 * mean trusting the file (another escrow) or there is nothing to check against (no such batch).
 */
import type { Receipt } from "@elivo/shared/receipt";
import { receiptHashB58Web, totalsProblems, verifyReceiptWeb } from "@elivo/shared/receipt-web";
import { viewCall } from "./rpc.ts";

export type CheckId = "format" | "escrow" | "signature" | "anchor" | "totals";
export interface Check {
  id: CheckId;
  ok: boolean;
  detail: string;
}
export interface VerifyOutcome {
  receipt: Receipt | null;
  checks: Check[];
  ok: boolean;
  hash: string | null;
}

type View = <T>(contractId: string, method: string, args?: object) => Promise<T>;

function parse(input: string): Receipt | null {
  try {
    const r = JSON.parse(input) as Receipt;
    const shaped =
      r &&
      typeof r === "object" &&
      r.version === "elivo-receipt-1" &&
      typeof r.batch_id === "string" &&
      /^\d{1,20}$/.test(r.batch_id) &&
      Array.isArray(r.payouts) &&
      !!r.totals &&
      typeof r.totals === "object" &&
      !!r.signature &&
      typeof r.signature === "object";
    return shaped ? r : null;
  } catch {
    return null;
  }
}

export async function verifyAgainstChain(
  input: string,
  app: { escrow: string; network: string },
  view: View = viewCall,
): Promise<VerifyOutcome> {
  const r = parse(input);
  if (!r)
    return {
      receipt: null,
      checks: [{ id: "format", ok: false, detail: "Not an elivo-receipt-1 file" }],
      ok: false,
      hash: null,
    };
  const checks: Check[] = [];
  const done = (hash: string | null): VerifyOutcome => ({
    receipt: r,
    checks,
    hash,
    ok: checks.length === 4 && checks.every((c) => c.ok),
  });

  const sameEscrow = r.escrow === app.escrow && r.network === app.network;
  checks.push({
    id: "escrow",
    ok: sameEscrow,
    detail: sameEscrow
      ? `For ${app.escrow} on ${app.network}, the escrow this app uses`
      : `This receipt is for ${r.escrow} on ${r.network}; this app checks ${app.escrow} on ${app.network}`,
  });
  if (!sameEscrow) return done(null);

  let batch: { receipt_pk: string; receipt_hash: string | null } | null;
  try {
    batch = await view(app.escrow, "get_batch", { batch_id: r.batch_id });
  } catch (e) {
    checks.push({ id: "anchor", ok: false, detail: `Could not read the chain: ${(e as Error).message}` });
    return done(null);
  }
  if (!batch) {
    checks.push({ id: "anchor", ok: false, detail: `No batch ${r.batch_id} on ${app.escrow}` });
    return done(null);
  }

  const v = await verifyReceiptWeb(r, batch.receipt_pk);
  checks.push({
    id: "signature",
    ok: v.ok,
    detail: v.ok
      ? `Signed by the batch's receipt key on-chain, ${batch.receipt_pk}`
      : v.reason === "key_mismatch"
        ? `Signed by ${r.signature.public_key}, but the batch's receipt key on-chain is ${batch.receipt_pk}`
        : v.reason === "bad_signature"
          ? "The signature does not match the contents: the file was changed after signing"
          : "No valid signature in the file",
  });

  const hash = await receiptHashB58Web(r);
  checks.push(
    !batch.receipt_hash
      ? {
          id: "anchor",
          ok: false,
          detail: `Not anchored yet: the escrow has no receipt hash for batch ${r.batch_id}`,
        }
      : batch.receipt_hash === hash
        ? { id: "anchor", ok: true, detail: `Hash ${hash} matches the hash anchored on-chain` }
        : {
            id: "anchor",
            ok: false,
            detail: `Hash ${hash} differs from the hash anchored on-chain, ${batch.receipt_hash}`,
          },
  );

  let problems: string[];
  try {
    problems = totalsProblems(r);
  } catch {
    problems = ["unreadable amounts"];
  }
  checks.push({
    id: "totals",
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `Totals add up from the ${r.payouts.length} payout rows`
        : `These totals don't add up from the rows: ${problems.join(", ")}`,
  });
  return done(hash);
}
