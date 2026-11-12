import { readFileSync } from "node:fs";
import { keyFromSeed } from "@elivo/shared/keys";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine.ts";
import { createRouterServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { validateCsv } from "../src/validate.ts";

const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");

function setup(proposalsFor: (draftId: string) => object[] = () => []) {
  const store = new Store(null);
  const draft = validateCsv(csv, "18.50").draft!;
  store.put(draft);
  const proposals = proposalsFor(draft.id);
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
    const { app, draft } = setup((id) => [
      { id: 0, proposer: "x", description: "something else", kind: {}, status: "Approved", votes: {} },
      {
        id: 1,
        proposer: "c.test",
        description: `Elivo payout batch ${id}: 5 payouts`,
        kind: { FunctionCall: { receiver_id: "usdc.test" } },
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
      kind: { FunctionCall: { receiver_id: "usdc.test" } },
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
});
