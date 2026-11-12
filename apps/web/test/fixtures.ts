import type { BatchView, ConfigView, PayoutView } from "@elivo/shared/views";
import type { ChainViews, RouterBatchStatus } from "../lib/status.ts";

export const S = 1_000_000_000n;
export const FIRMS = { "mx1.t": "MX-1", "mx2.t": "MX-2", "mx3.t": "MX-3" };

export const config = { paused: false, receipt_pk: "ed25519:K" } as ConfigView;

export const batch: BatchView = {
  id: "5",
  funder: "dao.t",
  batch_hash: "ab",
  funded_at_ns: String(100n * S),
  payout_count: 5,
  router_id: "router.t",
  oracle_pk: "ed25519:O",
  receipt_pk: "ed25519:K",
  receipt_hash: "HASH",
};

export function payout(id: number, over: Partial<PayoutView>): PayoutView {
  return {
    batch_id: "5",
    id,
    amount: "2000000000",
    locked: "2005000000",
    state: "Funded",
    firm: null,
    quote_bps: 0,
    cutoff_ns: String(140n * S),
    final_deadline_ns: String(400n * S),
    penalties_total: "0",
    firms_tried: [],
    excluded: false,
    delivered_at_ns: null,
    proof_ref: null,
    ...over,
  };
}

export const terminalPayouts: PayoutView[] = [
  payout(0, {
    state: "Delivered",
    firm: "mx1.t",
    firms_tried: ["mx1.t"],
    delivered_at_ns: String(120n * S),
    proof_ref: "CEP-SIM-1",
  }),
  payout(1, {
    state: "Delivered",
    firm: "mx1.t",
    firms_tried: ["mx3.t", "mx1.t"],
    penalties_total: "900000",
    delivered_at_ns: String(160n * S),
    proof_ref: "CEP-SIM-2",
  }),
  payout(2, { state: "Refunded", firm: "mx2.t", firms_tried: ["mx2.t"], excluded: true }),
  payout(3, {
    state: "Delivered",
    firm: "mx2.t",
    firms_tried: ["mx2.t"],
    delivered_at_ns: String(130n * S),
    proof_ref: "CEP-SIM-3",
  }),
  payout(4, {
    state: "Delivered",
    firm: "mx2.t",
    firms_tried: ["mx2.t"],
    delivered_at_ns: String(125n * S),
    proof_ref: "CEP-SIM-4",
  }),
];

export const views = (payouts: PayoutView[] = terminalPayouts, b: BatchView | null = batch): ChainViews => ({
  batch: b,
  payouts,
  config,
});

export const overlay: RouterBatchStatus = {
  draft: {
    id: "d-1",
    batch_hash: "ab",
    rows: [
      ["Lucía Fernández", "7771"],
      ["Mateo Ríos", "9719"],
      ["Sofía Herrera", "7899"],
      ["Diego Navarro", "3213"],
      ["Valentina Cruz", "5554"],
    ].map(([name, last4], i) => ({
      row: i + 2,
      name,
      clabe_last4: last4,
      amount_mxn: "37000.00",
      amount_usdc: "2000000000",
    })),
  },
  onchain: batch,
  payouts: terminalPayouts.map((p) => ({
    ...p,
    txs: { assign: [{ hash: `tx-assign-${p.id}`, url: null }] },
  })),
  receipt_ready: true,
  anchor_tx: { hash: "tx-anchor", url: null },
};
