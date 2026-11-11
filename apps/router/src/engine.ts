/**
 * Router engine. Stateless with respect to the chain: every tick it reads the escrow's views and
 * decides per payout (assign / reroute / refund), then anchors a signed receipt once a batch is
 * closed. The local store holds only off-chain data (payees, salts, tx hashes, the receipt).
 * The router signs with a function-call key and can only assign, reroute, settle, exclude,
 * refund and anchor; it cannot move funds anywhere else.
 */
import { type ChainAccount, ChainCallError } from "@elivo/shared/chain";
import type { Ed25519Key } from "@elivo/shared/keys";
import { type Receipt, receiptHashB58, signReceipt } from "@elivo/shared/receipt";
import type { BatchView, ConfigView, FirmView, PayoutView } from "@elivo/shared/views";
import { buildFundingProposal, type FundingProposal } from "./proposal.ts";
import { buildReceiptBody } from "./receipt-build.ts";
import { decide, type FirmCapacity, pickFirm, type SignedQuote } from "./select.ts";
import type { Draft, Store } from "./store.ts";

export const GAS = {
  assign: 30,
  reroute: 80,
  settle: 100,
  exclude: 30,
  refund: 80,
  anchor_receipt: 30,
} as const;

export interface ChainLike {
  view<T>(contractId: string, method: string, args?: object): Promise<T>;
  blockTimeNs(): Promise<bigint>;
  explorerTx(hash: string): string | null;
}

export interface FirmClient {
  quote(url: string, body: { batch_id: string; payout_id: number; amount: string }): Promise<SignedQuote>;
  order(
    url: string,
    body: {
      batch_id: string;
      payout_id: number;
      clabe: string;
      name: string;
      amount_mxn: string;
      cutoff_ms: number;
    },
  ): Promise<void>;
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

export const httpFirmClient: FirmClient = {
  quote: (url, body) => postJson<SignedQuote>(`${url}/quote`, body),
  order: async (url, body) => void (await postJson(`${url}/orders`, body)),
};

export interface EngineDeps {
  chain: ChainLike;
  router: ChainAccount;
  escrowId: string;
  store: Store;
  firms: Array<{ id: string; url: string }>;
  firmClient: FirmClient;
  graceNs: bigint;
  receiptKey: Ed25519Key;
  network: string;
  proposal?: { daoId: string; usdcId: string; cutoffInS: number; deadlineInS: number };
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export type SubmitResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

export interface RerouteRecord {
  batch_id: string;
  payout_id: number;
  from: string | null;
  to: string;
  cutoff_ns: bigint;
  /** Block time read right after the reroute tx returned; the tx was included at or before it. */
  included_by_ns: bigint;
}

const PANIC_TO_HTTP: Record<string, string> = {
  wrong_state: "already_settled",
  wrong_firm: "not_current_firm",
  nonce_used: "nonce_used",
  bad_oracle_sig: "bad_oracle_sig",
  proof_mismatch: "proof_mismatch",
};

export class Engine {
  readonly reroutes: RerouteRecord[] = [];
  private scanned = 0;
  private readonly log: NonNullable<EngineDeps["log"]>;

  constructor(private readonly deps: EngineDeps) {
    this.log = deps.log ?? (() => {});
  }

  setFirms(firms: Array<{ id: string; url: string }>) {
    this.deps.firms = firms;
  }

  draftIdFor(onchainId: string): string | undefined {
    return this.deps.store.byOnchainId(onchainId)?.id;
  }

  get store(): Store {
    return this.deps.store;
  }

  get chain(): ChainLike {
    return this.deps.chain;
  }

  get escrowId(): string {
    return this.deps.escrowId;
  }

  // ---------- periodic work ----------

  async tick(): Promise<void> {
    try {
      const now = await this.deps.chain.blockTimeNs();
      await this.linkFundedBatches();
      for (const draft of this.deps.store.all()) {
        if (draft.onchain_batch_id === undefined || draft.anchor_tx) continue;
        await this.workBatch(draft, now);
      }
    } catch (e) {
      this.log("tick failed", { error: (e as Error).message });
    }
  }

  private async linkFundedBatches() {
    const count = Number(await this.deps.chain.view<string>(this.deps.escrowId, "get_batch_count"));
    for (let id = this.scanned; id < count; id++) {
      const b = await this.deps.chain.view<BatchView | null>(this.deps.escrowId, "get_batch", {
        batch_id: String(id),
      });
      const draft = b && this.deps.store.byHash(b.batch_hash);
      if (draft && draft.onchain_batch_id === undefined) {
        this.deps.store.update(draft.id, (d) => {
          d.onchain_batch_id = String(id);
        });
        this.log("batch funded", { batch_id: id, draft: draft.id });
      }
    }
    this.scanned = count;
  }

  private async workBatch(draft: Draft, now: bigint) {
    const batchId = draft.onchain_batch_id as string;
    const payouts = await this.deps.chain.view<PayoutView[]>(this.deps.escrowId, "get_batch_payouts", {
      batch_id: batchId,
    });
    for (const p of payouts) {
      try {
        const d = decide(p, now, this.deps.graceNs);
        if (d === "assign" || d === "reroute") await this.route(draft, p, d, now);
        else if (d === "refund") await this.refund(draft, p.id);
      } catch (e) {
        this.log("payout action failed", { batch_id: batchId, payout_id: p.id, error: (e as Error).message });
      }
    }
    const fresh = await this.deps.chain.view<PayoutView[]>(this.deps.escrowId, "get_batch_payouts", {
      batch_id: batchId,
    });
    if (fresh.length > 0 && fresh.every((p) => p.state === "Delivered" || p.state === "Refunded")) {
      await this.anchor(draft, fresh);
    }
  }

  private async capacities(): Promise<Record<string, FirmCapacity>> {
    const list = await this.deps.chain.view<Array<[string, FirmView]>>(this.deps.escrowId, "list_firms");
    return Object.fromEntries(
      list.map(([id, f]) => [
        id,
        { bond: BigInt(f.bond), open_exposure: BigInt(f.open_exposure), approved: f.approved },
      ]),
    );
  }

  private async route(draft: Draft, p: PayoutView, kind: "assign" | "reroute", now: bigint) {
    const batchId = draft.onchain_batch_id as string;
    const quotes = (
      await Promise.allSettled(
        this.deps.firms
          .filter((f) => !p.firms_tried.includes(f.id))
          .map((f) =>
            this.deps.firmClient.quote(f.url, { batch_id: batchId, payout_id: p.id, amount: p.amount }),
          ),
      )
    ).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const pick = pickFirm(quotes, await this.capacities(), p.firms_tried, BigInt(p.amount));
    if (!pick) {
      this.log("no eligible firm", { batch_id: batchId, payout_id: p.id, kind });
      return;
    }
    const args =
      kind === "assign"
        ? {
            batch_id: batchId,
            payout_id: p.id,
            firm_id: pick.firm_id,
            quote_bps: pick.quote_bps,
            quote_sig: pick.quote_sig,
          }
        : {
            batch_id: batchId,
            payout_id: p.id,
            new_firm_id: pick.firm_id,
            quote_bps: pick.quote_bps,
            quote_sig: pick.quote_sig,
          };
    const r = await this.deps.router.call(this.deps.escrowId, kind, args, { gasTgas: GAS[kind] });
    this.deps.store.addTx(draft.id, p.id, kind, r.txHash);
    const after = await this.deps.chain.view<PayoutView>(this.deps.escrowId, "get_payout", {
      batch_id: batchId,
      payout_id: p.id,
    });
    const nowAfter = await this.deps.chain.blockTimeNs();
    if (kind === "reroute") {
      this.reroutes.push({
        batch_id: batchId,
        payout_id: p.id,
        from: p.firm,
        to: pick.firm_id,
        cutoff_ns: BigInt(p.cutoff_ns),
        included_by_ns: nowAfter,
      });
    }
    this.log(kind === "assign" ? "assigned" : "rerouted", {
      batch_id: batchId,
      payout_id: p.id,
      from: p.firm,
      to: pick.firm_id,
      quote_bps: pick.quote_bps,
      tx: r.txHash,
    });
    const row = draft.rows[p.id];
    const cutoffMs = Number(
      (BigInt(after?.cutoff_ns ?? p.cutoff_ns) - (nowAfter > now ? nowAfter : now)) / 1_000_000n,
    );
    const url = this.deps.firms.find((f) => f.id === pick.firm_id)?.url;
    if (url && row) {
      await this.deps.firmClient
        .order(url, {
          batch_id: batchId,
          payout_id: p.id,
          clabe: row.clabe,
          name: row.name,
          amount_mxn: row.amount_mxn,
          cutoff_ms: Math.max(cutoffMs, 0),
        })
        .catch((e) =>
          this.log("order delivery to firm failed", { firm: pick.firm_id, error: (e as Error).message }),
        );
    }
  }

  private async refund(draft: Draft, payoutId: number) {
    const batchId = draft.onchain_batch_id as string;
    const r = await this.deps.router.call(
      this.deps.escrowId,
      "refund",
      { batch_id: batchId, payout_id: payoutId },
      { gasTgas: GAS.refund },
    );
    this.deps.store.addTx(draft.id, payoutId, "refund", r.txHash);
    this.log("refunded", { batch_id: batchId, payout_id: payoutId, tx: r.txHash });
  }

  private async anchor(draft: Draft, payouts: PayoutView[]) {
    const batchId = draft.onchain_batch_id as string;
    const batch = await this.deps.chain.view<BatchView>(this.deps.escrowId, "get_batch", {
      batch_id: batchId,
    });
    let receipt: Receipt | undefined = draft.receipt;
    if (!receipt) {
      receipt = signReceipt(
        buildReceiptBody(draft, batch, payouts, this.deps.network, this.deps.escrowId),
        this.deps.receiptKey,
      );
      const r = receipt;
      this.deps.store.update(draft.id, (d) => {
        d.receipt = r;
      });
    }
    const hash = receiptHashB58(receipt);
    if (!batch.receipt_hash) {
      const r = await this.deps.router.call(
        this.deps.escrowId,
        "anchor_receipt",
        { batch_id: batchId, receipt_hash: hash },
        { gasTgas: GAS.anchor_receipt },
      );
      this.deps.store.update(draft.id, (d) => {
        d.anchor_tx = r.txHash;
      });
      this.log("receipt anchored", { batch_id: batchId, receipt_hash: hash, tx: r.txHash });
    } else {
      this.deps.store.update(draft.id, (d) => {
        d.anchor_tx = d.anchor_tx ?? "already-anchored";
      });
    }
  }

  // ---------- inbound from the oracle ----------

  private async submit(
    kind: "settle" | "exclude",
    json: { batch_id: string; payout_id: number },
    sig: string,
    args: object,
  ): Promise<SubmitResult> {
    const draft = this.deps.store.byOnchainId(json.batch_id);
    if (!draft) return { ok: false, status: 404, error: "unknown_batch" };
    const p = await this.deps.chain.view<PayoutView | null>(this.deps.escrowId, "get_payout", {
      batch_id: json.batch_id,
      payout_id: json.payout_id,
    });
    if (!p) return { ok: false, status: 404, error: "unknown_payout" };
    if (p.state !== "Assigned" || p.excluded) return { ok: false, status: 409, error: "already_settled" };
    try {
      const r = await this.deps.router.call(
        this.deps.escrowId,
        kind,
        { ...args, oracle_sig: sig },
        { gasTgas: GAS[kind] },
      );
      this.deps.store.addTx(draft.id, json.payout_id, kind, r.txHash);
      this.log(kind === "settle" ? "delivered" : "excluded", {
        batch_id: json.batch_id,
        payout_id: json.payout_id,
        tx: r.txHash,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof ChainCallError && PANIC_TO_HTTP[e.panic]) {
        return { ok: false, status: 409, error: PANIC_TO_HTTP[e.panic] };
      }
      return { ok: false, status: 400, error: (e as Error).message };
    }
  }

  async submitProof(proof: { batch_id: string; payout_id: number }, sig: string): Promise<SubmitResult> {
    return this.submit("settle", proof, sig, { batch_id: proof.batch_id, payout_id: proof.payout_id, proof });
  }

  async submitExclusion(
    exclusion: { batch_id: string; payout_id: number; reason_code?: number },
    sig: string,
  ): Promise<SubmitResult> {
    const r = await this.submit("exclude", exclusion, sig, {
      batch_id: exclusion.batch_id,
      payout_id: exclusion.payout_id,
      exclusion,
    });
    if (!r.ok) return r;
    const draft = this.deps.store.byOnchainId(exclusion.batch_id) as Draft;
    this.deps.store.update(draft.id, (d) => {
      d.exclusion_reasons[exclusion.payout_id] = "ACCOUNT_CLOSED";
    });
    await this.refund(draft, exclusion.payout_id).catch((e) =>
      this.log("refund after exclusion failed; the next tick retries", { error: (e as Error).message }),
    );
    return r;
  }

  async order(
    batchId: string,
    payoutId: number,
  ): Promise<{ firm_id: string | null; state: string; excluded: boolean } | null> {
    const p = await this.deps.chain.view<PayoutView | null>(this.deps.escrowId, "get_payout", {
      batch_id: batchId,
      payout_id: payoutId,
    });
    return p ? { firm_id: p.firm, state: p.state, excluded: p.excluded } : null;
  }

  // ---------- proposals ----------

  async proposalFor(draft: Draft): Promise<FundingProposal> {
    const cfg = this.deps.proposal;
    if (!cfg) throw new Error("proposal settings not configured");
    const [escrowCfg, policy] = await Promise.all([
      this.deps.chain.view<ConfigView>(this.deps.escrowId, "get_config"),
      this.deps.chain.view<{ proposal_bond: string }>(cfg.daoId, "get_policy"),
    ]);
    return buildFundingProposal(draft, {
      daoId: cfg.daoId,
      usdcId: cfg.usdcId,
      escrowId: this.deps.escrowId,
      routerId: escrowCfg.router_id,
      oraclePk: escrowCfg.oracle_pk,
      cutoffInNs: BigInt(cfg.cutoffInS) * 1_000_000_000n,
      deadlineInNs: BigInt(cfg.deadlineInS) * 1_000_000_000n,
      proposalBondYocto: policy.proposal_bond,
    });
  }
}
