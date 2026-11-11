/** Builds the receipt body from contract views plus the router's local, off-chain records. */
import { createHash } from "node:crypto";
import { clabeLast4 } from "@elivo/shared/clabe";
import { LABEL, type ReceiptBody } from "@elivo/shared/receipt";
import type { BatchView, PayoutView } from "@elivo/shared/views";
import type { Draft } from "./store.ts";

export function payeeRef(saltHex: string, clabe: string): string {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(saltHex, "hex"), Buffer.from(clabe)]))
    .digest("hex");
}

export function buildReceiptBody(
  draft: Draft,
  batch: BatchView,
  payouts: PayoutView[],
  network: string,
  escrowId: string,
  generatedAt = new Date().toISOString(),
): ReceiptBody {
  let locked = 0n;
  let paid = 0n;
  let penalties = 0n;
  const rows = payouts.map((p) => {
    const amount = BigInt(p.amount);
    locked += BigInt(p.locked);
    penalties += BigInt(p.penalties_total);
    const delivered = p.state === "Delivered";
    if (delivered) paid += amount + (amount * BigInt(p.quote_bps)) / 10_000n;
    const row = draft.rows[p.id];
    return {
      id: p.id,
      amount_usdc: p.amount,
      amount_mxn: row?.amount_mxn ?? "",
      payee_ref: row ? payeeRef(draft.salt_hex, row.clabe) : "",
      clabe_last4: row ? clabeLast4(row.clabe) : "",
      state: p.state as "Delivered" | "Refunded",
      excluded: p.excluded,
      reason: p.excluded ? (draft.exclusion_reasons[p.id] ?? "ACCOUNT_CLOSED") : null,
      firms_tried: p.firms_tried,
      final_firm: delivered ? p.firm : null,
      quote_bps: p.quote_bps,
      cutoff_ns: p.cutoff_ns,
      final_deadline_ns: p.final_deadline_ns,
      delivered_at_ns: p.delivered_at_ns,
      proof_ref: p.proof_ref,
      penalties_total: p.penalties_total,
      txs: structuredClone(draft.txs[p.id] ?? {}), // a copy: later records must not alter a signed receipt
    };
  });
  return {
    version: "elivo-receipt-1",
    label: LABEL,
    network,
    escrow: escrowId,
    batch_id: batch.id,
    batch_hash: batch.batch_hash,
    funder: batch.funder,
    generated_at: generatedAt,
    payouts: rows,
    totals: {
      locked: locked.toString(),
      paid_to_firms: paid.toString(),
      returned_to_funder: (locked - paid + penalties).toString(),
      penalties: penalties.toString(),
    },
  };
}
