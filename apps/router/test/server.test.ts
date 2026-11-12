import { readFileSync } from "node:fs";
import { keyFromSeed } from "@elivo/shared/keys";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine.ts";
import { createRouterServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { validateCsv } from "../src/validate.ts";

const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");
const b64json = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
const fundingKind = (hash: string) => ({
  FunctionCall: {
    receiver_id: "usdc.test",
    actions: [
      {
        method_name: "ft_transfer_call",
        args: b64json({
          receiver_id: "escrow.test",
          amount: "1",
          msg: JSON.stringify({ kind: "fund_batch", batch_hash: hash }),
        }),
        deposit: "1",
        gas: "1",
      },
    ],
  },
});

function setup(proposalsFor: (draftId: string, batchHash: string) => object[] = () => []) {
  const store = new Store(null);
  const draft = validateCsv(csv, "18.50").draft!;
  store.put(draft);
  const proposals = proposalsFor(draft.id, draft.batch_hash);
  const chain = {
    async view<T>(_c: string, method: string): Promise<T> {
      const r: Record<string, unknown> = {
        get_last_proposal_id: proposals.length,
        get_proposals: proposals,
        get_policy: {
          proposal_bond: "1",
          roles: [
            { name: "council", kind: { Group: ["c.test"] } },
            { name: "all", kind: "Everyone" },
          ],
        },
      };
      return r[method] as T;
    },
    async blockTimeNs() {
      return 0n;
    },
    explorerTx: () => null,
  };
  const engine = new Engine({
    chain,
    router: { accountId: "router", call: async () => ({ txHash: "", logs: [] }) },
    escrowId: "escrow.test",
    store,
    firms: [],
    firmClient: { quote: async () => null, order: async () => {} } as never,
    graceNs: 5_000_000_000n,
    receiptKey: keyFromSeed(new Uint8Array(32).fill(7)),
    network: "sandbox",
    proposal: { daoId: "dao.test", usdcId: "usdc.test", cutoffInS: 40, deadlineInS: 300 },
  });
  return { app: createRouterServer(engine, { rate: "18.50" }), draft };
}

describe("router server", () => {
  it("GET /config reports the batch timing and the fee buffer", async () => {
    const { app } = setup();
    const r = await app.inject({ method: "GET", url: "/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      network: "sandbox",
      escrow: "escrow.test",
      rate: "18.50",
      cutoff_in_s: 40,
      deadline_in_s: 300,
      grace_ms: 5000,
      fee_buffer_bps: 25,
    });
  });

  it("GET /batches/:id/dao-proposal is 404 unknown_draft for an unknown draft", async () => {
    const { app } = setup();
    const r = await app.inject({ method: "GET", url: "/batches/nope/dao-proposal" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "unknown_draft" });
  });

  it("GET /batches/:id/dao-proposal is 404 no_proposal before a proposal exists", async () => {
    const { app, draft } = setup();
    const r = await app.inject({ method: "GET", url: `/batches/${draft.id}/dao-proposal` });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "no_proposal" });
  });

  it("GET /batches/:id/dao-proposal returns the proposal and the council", async () => {
    const { app, draft } = setup((id, hash) => [
      { id: 0, proposer: "x", description: "something else", kind: {}, status: "Approved", votes: {} },
      {
        id: 1,
        proposer: "c.test",
        description: `Elivo payout batch ${id}: 5 payouts`,
        kind: fundingKind(hash),
        status: "InProgress",
        votes: {},
      },
    ]);
    const r = await app.inject({ method: "GET", url: `/batches/${draft.id}/dao-proposal` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      id: 1,
      proposer: "c.test",
      status: "InProgress",
      kind: fundingKind(draft.batch_hash),
      votes: {},
      council: ["c.test"],
    });
  });

  it("GET /samples/:name serves the two sample CSVs and nothing else", async () => {
    const { app } = setup();
    const ok = await app.inject({ method: "GET", url: "/samples/payees.csv" });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/text\/csv/);
    expect(ok.body).toBe(csv);
    expect((await app.inject({ method: "GET", url: "/samples/payees-with-error.csv" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/samples/..%2Fpackage.json" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/samples/other.csv" })).statusCode).toBe(404);
  });

  it("GET /quote/payin proxies the quoter and validates the amount", async () => {
    const store = new Store(null);
    const engine = new Engine({
      chain: { view: async () => ({}) as never, blockTimeNs: async () => 0n, explorerTx: () => null },
      router: { accountId: "r", call: async () => ({ txHash: "", logs: [] }) },
      escrowId: "e",
      store,
      firms: [],
      firmClient: {} as never,
      graceNs: 0n,
      receiptKey: keyFromSeed(new Uint8Array(32).fill(1)),
      network: "sandbox",
    });
    const seen: string[] = [];
    const app = createRouterServer(engine, {
      payin: {
        tokens: async () => [],
        quote: async (a, n) => {
          seen.push(`${a}:${n}`);
          return { ok: false, reason: "timeout" };
        },
      },
    });
    const r = await app.inject({
      method: "GET",
      url: "/quote/payin?asset=nep141:eth.omft.near&amount=9022500000",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: false, reason: "timeout" });
    expect(seen).toEqual(["nep141:eth.omft.near:9022500000"]);
    expect((await app.inject({ method: "GET", url: "/quote/payin?asset=x&amount=-1" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/quote/assets" })).json()).toHaveLength(4);
  });

  it("GET /batches/:id/dao-proposal ignores look-alike proposals that do something else", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
    const funding = (hash: string) => ({
      FunctionCall: {
        receiver_id: "usdc.test",
        actions: [
          {
            method_name: "ft_transfer_call",
            args: b64({
              receiver_id: "escrow.test",
              amount: "1",
              msg: JSON.stringify({ kind: "fund_batch", batch_hash: hash }),
            }),
            deposit: "1",
            gas: "1",
          },
        ],
      },
    });
    const p = (id: number, desc: string, kind: object) => ({
      id,
      proposer: "x",
      description: desc,
      kind,
      status: "InProgress",
      votes: {},
    });
    const { app, draft } = setup((id, hash) => [
      p(0, `Elivo payout batch ${id}: 5 payouts`, funding(hash)),
      p(1, `Elivo payout batch ${id}: 5 payouts`, { ChangePolicy: { policy: {} } }),
      p(2, `Elivo payout batch ${id}: 5 payouts`, funding("another-batch")),
      p(3, `Spoof: Elivo payout batch ${id}: 5 payouts`, funding(hash)),
    ]);
    const r = await app.inject({ method: "GET", url: `/batches/${draft.id}/dao-proposal` });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(0);
    const { app: onlyFake, draft: d2 } = setup((id) => [
      p(0, `Elivo payout batch ${id}: x`, { ChangePolicy: { policy: {} } }),
    ]);
    expect((await onlyFake.inject({ method: "GET", url: `/batches/${d2.id}/dao-proposal` })).statusCode).toBe(
      404,
    );
  });
});
