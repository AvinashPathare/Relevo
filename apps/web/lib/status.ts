/**
 * Status model for a funded batch. Contract views are the source of truth; the router overlay only
 * adds payee names (with the last 4 CLABE digits) and tx links. Pure, so it is tested without a browser.
 */
import { formatUsdc } from "@elivo/shared/money";
import type { BatchView, ConfigView, PayoutState, PayoutView } from "@elivo/shared/views";
import { type ViewOptions, viewCall } from "./rpc.ts";

export interface ChainViews {
  batch: BatchView | null;
  payouts: PayoutView[];
  config: ConfigView;
}

export interface TxLink {
  hash: string;
  url: string | null;
}

/** Shape of the router's GET /batches/:id. */
export interface RouterBatchStatus {
  draft: {
    id: string;
    batch_hash: string;
    rows: Array<{ row: number; name: string; clabe_last4: string; amount_mxn: string; amount_usdc: string }>;
  };
  onchain: BatchView | null;
  payouts: Array<PayoutView & { txs: Record<string, TxLink[]> }>;
  receipt_ready: boolean;
  anchor_tx: TxLink | null;
}

export interface StatusRow {
  id: number;
  amountUsdc: string;
  state: PayoutState;
  label: string;
  route: string;
  penalty: string;
  proofRef: string | null;
  payee: string | null;
  txs: Array<{ kind: string } & TxLink>;
}

export interface StatusModel {
  found: boolean;
  batchId: string | null;
  funder: string | null;
  receiptHash: string | null;
  anchored: boolean;
  terminal: boolean;
  paused: boolean;
  totals: { locked: string; delivered: string; refunded: string; penalties: string };
  rows: StatusRow[];
}

export async function loadChainViews(
  escrow: string,
  batchId: string,
  opts: ViewOptions = {},
): Promise<ChainViews> {
  const [batch, config] = await Promise.all([
    viewCall<BatchView | null>(escrow, "get_batch", { batch_id: batchId }, opts),
    viewCall<ConfigView>(escrow, "get_config", {}, opts),
  ]);
  const payouts = batch
    ? await viewCall<PayoutView[]>(escrow, "get_batch_payouts", { batch_id: batchId }, opts)
    : [];
  return { batch, payouts, config };
}

const S = 1_000_000_000n;

function labelFor(p: PayoutView, name: (id: string | null) => string, nowNs?: bigint): string {
  const firm = name(p.firm);
  const rerouted = p.firms_tried.length > 1;
  switch (p.state) {
    case "Delivered":
      if (rerouted) return `Delivered after reroute by ${firm}`;
      if (p.delivered_at_ns && BigInt(p.delivered_at_ns) > BigInt(p.cutoff_ns))
        return `Delivered late by ${firm} (penalty charged)`;
      return `Delivered on time by ${firm}`;
    case "Refunded":
      return p.excluded ? "Refunded: account closed (no penalty)" : "Refunded: deadline passed";
    case "Assigned": {
      if (p.excluded) return "Account closed: refund pending";
      if (rerouted)
        return `Rerouted: ${name(p.firms_tried.at(-2) ?? null)} missed its cut-off, now with ${firm}`;
      if (nowNs === undefined) return `Assigned to ${firm}`;
      const left = BigInt(p.cutoff_ns) - nowNs;
      return left > 0n
        ? `Assigned to ${firm}, cut-off in ${(left + S - 1n) / S} s`
        : `Assigned to ${firm}, cut-off passed`;
    }
    default:
      return "Waiting for a firm";
  }
}

export function buildStatus(
  views: ChainViews,
  overlay: RouterBatchStatus | null,
  firms: Record<string, string>,
  nowNs?: bigint,
): StatusModel {
  const name = (id: string | null) => (id ? (firms[id] ?? id) : "-");
  const payouts = [...views.payouts].sort((a, b) => a.id - b.id);
  const sum = (xs: string[]) => formatUsdc(xs.reduce((s, x) => s + BigInt(x), 0n));
  const rows: StatusRow[] = payouts.map((p) => {
    const r = overlay?.draft.rows[p.id];
    const txs = overlay?.payouts.find((x) => x.id === p.id)?.txs ?? {};
    return {
      id: p.id,
      amountUsdc: formatUsdc(BigInt(p.amount)),
      state: p.state,
      label: labelFor(p, name, nowNs),
      route: p.firms_tried.map((f) => name(f)).join(" → "),
      penalty: formatUsdc(BigInt(p.penalties_total)),
      proofRef: p.proof_ref,
      payee: r ? `${r.name} ****${r.clabe_last4}` : null,
      txs: Object.entries(txs).flatMap(([kind, links]) => links.map((l) => ({ kind, ...l }))),
    };
  });
  return {
    found: views.batch !== null,
    batchId: views.batch?.id ?? null,
    funder: views.batch?.funder ?? null,
    receiptHash: views.batch?.receipt_hash ?? null,
    anchored: !!views.batch?.receipt_hash,
    terminal: payouts.length > 0 && payouts.every((p) => p.state === "Delivered" || p.state === "Refunded"),
    paused: !!views.config?.paused,
    totals: {
      locked: sum(payouts.map((p) => p.locked)),
      delivered: sum(payouts.filter((p) => p.state === "Delivered").map((p) => p.amount)),
      refunded: sum(payouts.filter((p) => p.state === "Refunded").map((p) => p.locked)),
      penalties: sum(payouts.map((p) => p.penalties_total)),
    },
    rows,
  };
}
