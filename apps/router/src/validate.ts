/** CSV → validated draft. Only the batch hash and amounts ever leave this machine. */
import { createHash, randomBytes } from "node:crypto";
import { clabeLast4 } from "@elivo/shared/clabe";
import { parsePayeeCsv, type RowError } from "@elivo/shared/csv";
import { lockedFor, mxnToUsdcUnits } from "@elivo/shared/money";
import canonicalize from "canonicalize";
import type { Draft } from "./store.ts";

/** The escrow's `min_payout` (1 USDC). Smaller payouts would make the whole funding transfer bounce after the vote. */
export const MIN_PAYOUT_UNITS = 1_000_000n;

export interface ValidationResult {
  ok: boolean;
  errors: RowError[];
  rows: Array<{ row: number; name: string; clabe_last4: string; amount_mxn: string; amount_usdc: string }>;
  draft?: Draft;
  total_locked?: string;
}

export function validateCsv(
  text: string,
  rate: string,
  newSalt: () => Uint8Array = () => randomBytes(32),
): ValidationResult {
  const parsed = parsePayeeCsv(text);
  const errors = [...parsed.errors];
  const valid = parsed.rows.filter((r) => {
    if (mxnToUsdcUnits(r.amount_mxn, rate) >= MIN_PAYOUT_UNITS) return true;
    errors.push({ row: r.row, reason: "below_min_payout" });
    return false;
  });
  errors.sort((a, b) => a.row - b.row);
  const rows = valid;
  const amounts = rows.map((r) => mxnToUsdcUnits(r.amount_mxn, rate));
  const publicRows = rows.map((r, i) => ({
    row: r.row,
    name: r.name,
    clabe_last4: clabeLast4(r.clabe),
    amount_mxn: r.amount_mxn,
    amount_usdc: amounts[i].toString(),
  }));
  if (errors.length > 0 || rows.length === 0) {
    return {
      ok: false,
      errors: errors.length ? errors : [{ row: 0, reason: "empty_batch" }],
      rows: publicRows,
    };
  }
  const salt_hex = Buffer.from(newSalt()).toString("hex");
  const canonical = canonicalize({
    salt: salt_hex,
    rows: rows.map((r, i) => ({
      name: r.name,
      clabe: r.clabe,
      amount_mxn: r.amount_mxn,
      amount_usdc: amounts[i].toString(),
    })),
  });
  const batch_hash = createHash("sha256")
    .update(canonical ?? "")
    .digest("hex");
  const draft: Draft = {
    id: batch_hash.slice(0, 12),
    salt_hex,
    rows,
    amounts_usdc: amounts.map(String),
    batch_hash,
    created_at: new Date().toISOString(),
    txs: {},
    exclusion_reasons: {},
  };
  const total = amounts.reduce((s, a) => s + lockedFor(a), 0n);
  return { ok: true, errors: [], rows: publicRows, draft, total_locked: total.toString() };
}
