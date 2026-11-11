import { readFileSync } from "node:fs";
import { ChainCallError } from "@elivo/shared/chain";
import { keyFromSeed } from "@elivo/shared/keys";
import type { PayoutView } from "@elivo/shared/views";
import { describe, expect, it } from "vitest";
import { Engine, type EngineDeps } from "../src/engine.ts";
import { Store } from "../src/store.ts";
import { validateCsv } from "../src/validate.ts";

const S = 1_000_000_000n;
const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");
const firstRow = csv.split("\n").slice(0, 2).join("\n");

function world(payoutOver: Partial<PayoutView> = {}, now = 100n * S) {
  const draft = validateCsv(firstRow, "18.50", () => new Uint8Array(32).fill(1)).draft!;
  const store = new Store(null);
  store.put(draft);
  const state = {
    now,
    failNext: 0,
    batchCount: 1,
    payout: {
      batch_id: "0",
      id: 0,
      amount: "2000000000",
      locked: "2005000000",
      state: "Funded",
      firm: null,
      quote_bps: 0,
      cutoff_ns: String(now + 40n * S),
      final_deadline_ns: String(now + 300n * S),
      penalties_total: "0",
      firms_tried: [],
      excluded: false,
      delivered_at_ns: null,
      proof_ref: null,
      ...payoutOver,
    } as PayoutView,
  };
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const firmsView: Array<[string, object]> = ["mx1", "mx2", "mx3"].map((f) => [
    f,
    { approved: true, bond: "1000000000", open_exposure: "0" },
  ]);
  const chain = {
    async view<T>(_c: string, method: string): Promise<T> {
      if (state.failNext > 0) {
        state.failNext--;
        throw new Error("rpc 503");
      }
      const r: Record<string, unknown> = {
        get_batch_count: String(state.batchCount),
        get_batch: {
          id: "0",
          batch_hash: draft.batch_hash,
          funder: "dao",
          receipt_hash: null,
          payout_count: 1,
        },
        get_batch_payouts: [state.payout],
        get_payout: state.payout,
        list_firms: firmsView,
      };
      return r[method] as T;
    },
    async blockTimeNs() {
      return state.now;
    },
    explorerTx: () => null,
  };
  const router = {
    accountId: "router",
    async call(_c: string, method: string, args: object) {
      calls.push({ method, args: args as Record<string, unknown> });
      if (method === "settle") {
        if (state.payout.state !== "Assigned")
          throw new ChainCallError("settle", "wrong_state", "wrong_state");
        state.payout = { ...state.payout, state: "Delivered" };
      }
      if (method === "assign")
        state.payout = { ...state.payout, state: "Assigned", firm: "mx3", firms_tried: ["mx3"] };
      return { txHash: `tx${calls.length}`, logs: [] };
    },
  };
  const firms = {
    async quote(firmId: string) {
      return {
        firm_id: firmId,
        quote_bps: { mx1: 22, mx2: 20, mx3: 18 }[firmId] as number,
        quote_sig: "c2ln",
      };
    },
    async order() {},
  };
  const deps: EngineDeps = {
    chain,
    router,
    escrowId: "escrow",
    store,
    firms: [
      { id: "mx1", url: "mx1" },
      { id: "mx2", url: "mx2" },
      { id: "mx3", url: "mx3" },
    ],
    firmClient: { quote: (url) => firms.quote(url), order: firms.order },
    graceNs: 5n * S,
    receiptKey: keyFromSeed(new Uint8Array(32).fill(2)),
    network: "sandbox",
  };
  return { deps, state, calls, store, draft };
}

describe("engine", () => {
  it("tick survives rpc error", async () => {
    const w = world();
    w.state.failNext = 1;
    await expect(new Engine(w.deps).tick()).resolves.toBeUndefined();
    const e = new Engine(w.deps);
    await e.tick();
    expect(w.calls.filter((c) => c.method === "assign")).toHaveLength(1);
    expect(w.calls[0].args).toMatchObject({ firm_id: "mx3", quote_bps: 18 });
  });

  it("duplicate proof is harmless", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    const e = new Engine(w.deps);
    const proof = {
      batch_id: "0",
      payout_id: 0,
      firm_id: "mx3",
      delivered_at_ns: "1",
      proof_ref: "CEP",
      nonce: "9",
    };
    expect(await e.submitProof(proof, "c2ln")).toEqual({ ok: true });
    expect(await e.submitProof(proof, "c2ln")).toEqual({ ok: false, status: 409, error: "already_settled" });
    expect(w.calls.filter((c) => c.method === "settle")).toHaveLength(1);
  });

  it("engine resumes after restart", async () => {
    const now = 1_000n * S;
    const w = world(
      {
        state: "Assigned",
        firm: "mx3",
        firms_tried: ["mx3"],
        cutoff_ns: String(now - 6n * S),
        final_deadline_ns: String(now + 200n * S),
      },
      now,
    );
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    await new Engine(w.deps).tick();
    expect(w.calls.map((c) => c.method)).toEqual(["reroute"]);
    expect(w.calls[0].args).toMatchObject({ new_firm_id: "mx2", quote_bps: 20 });
  });

  it("maps contract panics on proofs to HTTP errors", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    w.deps.router.call = async () => {
      throw new ChainCallError("settle", "wrong_firm", "wrong_firm");
    };
    const proof = {
      batch_id: "0",
      payout_id: 0,
      firm_id: "mx1",
      delivered_at_ns: "1",
      proof_ref: "CEP",
      nonce: "9",
    };
    expect(await new Engine(w.deps).submitProof(proof, "c2ln")).toEqual({
      ok: false,
      status: 409,
      error: "not_current_firm",
    });
  });
});

describe("engine on slow networks", () => {
  it("reads firm capacity once per batch and tracks exposure locally", async () => {
    const draft = validateCsv(csv.split("\n").slice(0, 3).join("\n"), "18.50", () =>
      new Uint8Array(32).fill(1),
    ).draft!;
    const store = new Store(null);
    store.put(draft);
    store.update(draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    const now = 100n * S;
    const payout = (id: number): PayoutView => ({
      batch_id: "0",
      id,
      amount: "2000000000",
      locked: "2005000000",
      state: "Funded",
      firm: null,
      quote_bps: 0,
      cutoff_ns: String(now + 120n * S),
      final_deadline_ns: String(now + 300n * S),
      penalties_total: "0",
      firms_tried: [],
      excluded: false,
      delivered_at_ns: null,
      proof_ref: null,
    });
    const views: Record<string, number> = {};
    const calls: Array<Record<string, unknown>> = [];
    const firmsView = [
      ["mx2", { approved: true, bond: "250000000", open_exposure: "0" }],
      ["mx3", { approved: true, bond: "100000000", open_exposure: "0" }], // capacity 2,000 USDC: one payout
    ];
    const engine = new Engine({
      chain: {
        async view<T>(_c: string, method: string): Promise<T> {
          views[method] = (views[method] ?? 0) + 1;
          const r: Record<string, unknown> = {
            get_batch_count: "1",
            get_batch: { id: "0", batch_hash: draft.batch_hash, receipt_hash: null },
            get_batch_payouts: [payout(0), payout(1)],
            list_firms: firmsView,
          };
          return r[method] as T;
        },
        blockTimeNs: async () => now,
        explorerTx: () => null,
      },
      router: {
        accountId: "router",
        async call(_c: string, _m: string, args: object) {
          calls.push(args as Record<string, unknown>);
          return { txHash: "tx", logs: [] };
        },
      },
      escrowId: "escrow",
      store,
      firms: [
        { id: "mx2", url: "mx2" },
        { id: "mx3", url: "mx3" },
      ],
      firmClient: {
        quote: async (url) => ({ firm_id: url, quote_bps: url === "mx3" ? 18 : 20, quote_sig: "c2ln" }),
        order: async () => {},
      },
      graceNs: 5n * S,
      receiptKey: keyFromSeed(new Uint8Array(32).fill(2)),
      network: "testnet",
    });
    await engine.tick();
    expect(calls.map((c) => c.firm_id)).toEqual(["mx3", "mx2"]);
    expect(views.list_firms).toBe(1);
    expect(views.get_payout ?? 0).toBe(0);
  });
});

describe("engine anchoring", () => {
  it("does not anchor while a proof submission is in flight", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const orig = w.deps.router.call;
    w.deps.router.call = async (c, m, a, o) => {
      if (m === "settle") {
        const r = await orig(c, m, a, o); // state becomes Delivered on-chain...
        await gate; // ...but the call has not returned to the router yet
        return r;
      }
      return orig(c, m, a, o);
    };
    const e = new Engine(w.deps);
    const proof = {
      batch_id: "0",
      payout_id: 0,
      firm_id: "mx3",
      delivered_at_ns: "1",
      proof_ref: "CEP",
      nonce: "9",
    };
    const pending = e.submitProof(proof, "c2ln");
    await new Promise((r) => setTimeout(r, 10));
    await e.tick();
    expect(w.calls.filter((c) => c.method === "anchor_receipt")).toHaveLength(0);
    release();
    await pending;
    await e.tick();
    expect(w.calls.filter((c) => c.method === "anchor_receipt")).toHaveLength(1);
    expect(w.store.get(w.draft.id)?.receipt?.payouts[0].txs.settle).toEqual(["tx1"]);
  });
});

describe("engine request budget", () => {
  it("an idle tick reads the batch once and skips the funding scan when no draft is waiting", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    const counts: Record<string, number> = {};
    const view = w.deps.chain.view.bind(w.deps.chain);
    w.deps.chain.view = async <T>(c: string, m: string, a?: object): Promise<T> => {
      counts[m] = (counts[m] ?? 0) + 1;
      return view<T>(c, m, a);
    };
    await new Engine(w.deps).tick();
    expect(counts).toEqual({ get_batch_payouts: 1 });
  });
});

describe("engine review fixes", () => {
  it("links only the DAO's batch whose amounts match the draft, not a copycat with the same hash", async () => {
    const w = world();
    w.deps.proposal = { daoId: "dao", usdcId: "usdc", cutoffInS: 40, deadlineInS: 300 };
    w.state.batchCount = 2;
    const view = w.deps.chain.view.bind(w.deps.chain);
    w.deps.chain.view = async <T>(c: string, m: string, a?: object): Promise<T> => {
      const id = (a as { batch_id?: string } | undefined)?.batch_id;
      if (m === "get_batch")
        return {
          id,
          batch_hash: w.draft.batch_hash,
          funder: id === "0" ? "attacker" : "dao",
          receipt_hash: null,
          payout_count: 1,
        } as T;
      if (m === "get_batch_payouts" && id === "0")
        return [{ ...w.state.payout, batch_id: "0", amount: "1000000" }] as T;
      return view<T>(c, m, a);
    };
    await new Engine(w.deps).tick();
    expect(w.store.get(w.draft.id)?.onchain_batch_id).toBe("1");
  });

  it("re-sends an order the current firm never received", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
    });
    const orders: string[] = [];
    w.deps.firmClient.order = async (url) => {
      orders.push(url);
    };
    const e = new Engine(w.deps);
    await e.tick();
    await e.tick();
    expect(orders).toEqual(["mx3"]);
    expect(w.store.get(w.draft.id)?.orders_sent?.[0]).toBe("mx3");
  });

  it("keeps anchoring blocked until the refund after an exclusion is recorded", async () => {
    const w = world({ state: "Assigned", firm: "mx3", firms_tried: ["mx3"] });
    w.store.update(w.draft.id, (d) => {
      d.onchain_batch_id = "0";
      d.orders_sent = { 0: "mx3" };
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const orig = w.deps.router.call;
    w.deps.router.call = async (c, m, a, o) => {
      if (m === "exclude") {
        w.state.payout = { ...w.state.payout, excluded: true };
        return orig(c, m, a, o);
      }
      if (m === "refund") {
        w.state.payout = { ...w.state.payout, state: "Refunded" };
        const r = await orig(c, m, a, o);
        await gate; // the refund landed but has not returned to the router yet
        return r;
      }
      return orig(c, m, a, o);
    };
    const e = new Engine(w.deps);
    const x = {
      batch_id: "0",
      payout_id: 0,
      firm_id: "mx3",
      reason_code: 1,
      observed_at_ns: "1",
      nonce: "5",
    };
    const pending = e.submitExclusion(x, "c2ln");
    await new Promise((r) => setTimeout(r, 10));
    await e.tick();
    expect(w.calls.filter((c) => c.method === "anchor_receipt")).toHaveLength(0);
    release();
    await pending;
    await e.tick();
    expect(w.calls.filter((c) => c.method === "anchor_receipt")).toHaveLength(1);
    expect(w.store.get(w.draft.id)?.receipt?.payouts[0].txs.refund).toHaveLength(1);
  });
});
