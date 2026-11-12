/**
 * Receipt → CSV for accounting tools: one row per payout, plain decimals (USDC with 6 places), ISO 8601
 * UTC times, and the batch id and receipt hash on every row. RFC 4180 quoting, CRLF line endings, and
 * a leading ' on cells a spreadsheet would treat as a formula. Browser-safe.
 */
import type { Receipt } from "./receipt.ts";

export const CSV_COLUMNS = [
  "batch_id",
  "network",
  "escrow",
  "receipt_hash",
  "payout_id",
  "state",
  "amount_usdc",
  "fee_usdc",
  "penalty_usdc",
  "amount_mxn",
  "payee_ref",
  "clabe_last4",
  "final_firm",
  "firms_tried",
  "delivered_at",
  "reason",
  "proof_ref",
  "tx_hashes",
] as const;

/** USDC base units → "1000.000000". */
function usdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

function iso(ns: string | null): string {
  return ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : "";
}

function cell(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function receiptToCsv(r: Receipt, receiptHash: string): string {
  const rows = r.payouts.map((p) => {
    const amount = BigInt(p.amount_usdc);
    const fee = p.state === "Delivered" ? (amount * BigInt(p.quote_bps)) / 10_000n : 0n;
    const txs = Object.entries(p.txs ?? {}).flatMap(([kind, hashes]) => hashes.map((h) => `${kind}:${h}`));
    const row: Record<(typeof CSV_COLUMNS)[number], string> = {
      batch_id: r.batch_id,
      network: r.network,
      escrow: r.escrow,
      receipt_hash: receiptHash,
      payout_id: String(p.id),
      state: p.state,
      amount_usdc: usdc(amount),
      fee_usdc: usdc(fee),
      penalty_usdc: usdc(BigInt(p.penalties_total)),
      amount_mxn: p.amount_mxn,
      payee_ref: p.payee_ref,
      clabe_last4: p.clabe_last4,
      final_firm: p.final_firm ?? "",
      firms_tried: p.firms_tried.join(" > "),
      delivered_at: iso(p.delivered_at_ns),
      reason: p.reason ?? "",
      proof_ref: p.proof_ref ?? "",
      tx_hashes: txs.join(" "),
    };
    return CSV_COLUMNS.map((c) => cell(row[c])).join(",");
  });
  return `${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}
