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
    signal: AbortSignal.timeout(10_000),
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
  /** settle/exclude calls sent but not yet returned; anchoring waits for them so the receipt has every tx. */
  private inflight = 0;
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

  get network(): string {
    return this.deps.network;
  }

  get graceNs(): bigint {
    return this.deps.graceNs;
  }

  get proposalSettings(): EngineDeps["proposal"] {
    return this.deps.proposal;
  }

  // ---------- periodic work ----------

  async tick(): Promise<void> {
    try {
      const now = await this.deps.chain.blockTimeNs();
      if (this.deps.store.all().some((d) => d.onchain_batch_id === undefined)) await this.linkFundedBatches();
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
      if (draft && draft.onchain_batch_id === undefined && (await this.matchesDraft(b, draft))) {
        this.deps.store.update(draft.id, (d) => {
          d.onchain_batch_id = String(id);
        });
        this.log("batch funded", { batch_id: id, draft: draft.id });
      } else if (draft && draft.onchain_batch_id === undefined) {
        this.log("ignored a batch with a matching hash but wrong funder or amounts", { batch_id: id });
      }
    }
    this.scanned = count;
  }

  /** The batch hash is public once proposed: also require the DAO as funder and the draft's exact amounts. */
  private async matchesDraft(b: BatchView, draft: Draft): Promise<boolean> {
    const dao = this.deps.proposal?.daoId;
    if (dao && b.funder !== dao) return false;
    if (b.payout_count !== draft.amounts_usdc.length) return false;
    const ps = await this.deps.chain.view<PayoutView[]>(this.deps.escrowId, "get_batch_payouts", {
      batch_id: b.id,
    });
    return ps.length === draft.amounts_usdc.length && ps.every((p) => p.amount === draft.amounts_usdc[p.id]);
  }

  private async workBatch(draft: Draft, now: bigint) {
    const batchId = draft.onchain_batch_id as string;
    const payouts = await this.deps.chain.view<PayoutView[]>(this.deps.escrowId, "get_batch_payouts", {
      batch_id: batchId,
    });
    const startedMs = Date.now();
    let caps: Record<string, FirmCapacity> | null = null;
    let acted = false;
    for (const p of payouts) {
      // Slow networks: estimate chain time as the tick advances instead of reusing the tick start.
      const nowEst = now + BigInt(Date.now() - startedMs) * 1_000_000n;
      try {
        const d = decide(p, nowEst, this.deps.graceNs);
        if (d === "assign" || d === "reroute") {
          acted = true;
          caps ??= await this.capacities();
          await this.route(draft, p, d, nowEst, caps);
        } else if (d === "refund") {
          acted = true;
          await this.refund(draft, p.id);
        } else if (p.state === "Assigned" && !p.excluded && p.firm && draft.orders_sent?.[p.id] !== p.firm) {
          // The firm may never have received its order (failed POST, timed-out tx that landed, restart).
          await this.sendOrder(draft, p.id, p.firm, BigInt(p.cutoff_ns), nowEst);
        }
      } catch (e) {
        this.log("payout action failed", { batch_id: batchId, payout_id: p.id, error: (e as Error).message });
      }
    }
    const fresh = acted
      ? await this.deps.chain.view<PayoutView[]>(this.deps.escrowId, "get_batch_payouts", {
          batch_id: batchId,
        })
      : payouts;
    if (fresh.length > 0 && fresh.every((p) => p.state === "Delivered" || p.state === "Refunded")) {
      if (this.inflight > 0) {
        this.log("batch closed; waiting for in-flight submissions before anchoring", { batch_id: batchId });
        return;
      }
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

  private rerouteWindowNs: bigint | null = null;

  private async route(
    draft: Draft,
    p: PayoutView,
    kind: "assign" | "reroute",
    now: bigint,
    caps: Record<string, FirmCapacity>,
  ) {
    const batchId = draft.onchain_batch_id as string;
    const amount = BigInt(p.amount);
    const quotes = (
      await Promise.allSettled(
        this.deps.firms
          .filter((f) => !p.firms_tried.includes(f.id))
          .map((f) =>
            this.deps.firmClient.quote(f.url, { batch_id: batchId, payout_id: p.id, amount: p.amount }),
          ),
      )
    ).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const pick = pickFirm(quotes, caps, p.firms_tried, amount);
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
    // Track exposure locally so later payouts in this tick see it without another read.
    caps[pick.firm_id].open_exposure += amount;
    if (p.firm && caps[p.firm]) caps[p.firm].open_exposure -= amount;

    let cutoffNs = BigInt(p.cutoff_ns);
    let orderFrom = now;
    if (kind === "reroute") {
      this.rerouteWindowNs ??= BigInt(
        (await this.deps.chain.view<ConfigView>(this.deps.escrowId, "get_config")).reroute_window_ns,
      );
      const includedBy = await this.deps.chain.blockTimeNs();
      const deadline = BigInt(p.final_deadline_ns);
      cutoffNs = includedBy + this.rerouteWindowNs < deadline ? includedBy + this.rerouteWindowNs : deadline;
      orderFrom = includedBy;
      this.reroutes.push({
        batch_id: batchId,
        payout_id: p.id,
        from: p.firm,
        to: pick.firm_id,
        cutoff_ns: BigInt(p.cutoff_ns),
        included_by_ns: includedBy,
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
    if (kind === "assign") {
      this.deps.store.update(draft.id, (d) => {
        d.assigned_at_ns ??= {};
        d.assigned_at_ns[p.id] ??= now.toString();
      });
    }
    await this.sendOrder(draft, p.id, pick.firm_id, cutoffNs, orderFrom);
  }

  private async sendOrder(draft: Draft, payoutId: number, firmId: string, cutoffNs: bigint, fromNs: bigint) {
    const row = draft.rows[payoutId];
    const url = this.deps.firms.find((f) => f.id === firmId)?.url;
    if (!url || !row) return;
    try {
      await this.deps.firmClient.order(url, {
        batch_id: draft.onchain_batch_id as string,
        payout_id: payoutId,
        clabe: row.clabe,
        name: row.name,
        amount_mxn: row.amount_mxn,
        cutoff_ms: Math.max(Number((cutoffNs - fromNs) / 1_000_000n), 0),
      });
      this.deps.store.update(draft.id, (d) => {
        d.orders_sent ??= {};
        d.orders_sent[payoutId] = firmId;
      });
    } catch (e) {
      this.log("order delivery to firm failed; the next tick retries", {
        firm: firmId,
        error: (e as Error).message,
      });
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
    this.inflight++;
    try {
      const r = await this.deps.router.call(
        this.deps.escrowId,
        kind,
        { ...args, oracle_sig: sig },
        { gasTgas: GAS[kind] },
      );
      this.deps.store.addTx(draft.id, json.payout_id, kind, r.txHash);
      this.deps.store.update(draft.id, (d) => {
        d.oracle_sigs ??= {};
        d.oracle_sigs[json.payout_id] = sig;
      });
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
    } finally {
      this.inflight--;
    }
  }

  async submitProof(proof: { batch_id: string; payout_id: number }, sig: string): Promise<SubmitResult> {
    return this.submit("settle", proof, sig, { batch_id: proof.batch_id, payout_id: proof.payout_id, proof });
  }

  async submitExclusion(
    exclusion: { batch_id: string; payout_id: number; reason_code?: number },
    sig: string,
  ): Promise<SubmitResult> {
    // Held across exclude + refund so the tick can't anchor before the refund tx is recorded.
    this.inflight++;
    try {
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
    } finally {
      this.inflight--;
    }
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
