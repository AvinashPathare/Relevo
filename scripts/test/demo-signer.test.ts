import type { Deployment } from "@elivo/shared/config";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoSigner } from "../lib/demo-signer.ts";

const d: Deployment = {
  network: "sandbox",
  rpcUrl: "http://127.0.0.1:3030",
  usdc: "usdc.t",
  escrow: "escrow.t",
  router: "router.t",
  firms: { mx1: "mx1.t", mx2: "mx2.t", mx3: "mx3.t" },
  council: "council.t",
  dao: "dao.t",
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
const kindFor = (receiver: string, escrow = d.escrow) => ({
  FunctionCall: {
    receiver_id: receiver,
    actions: [
      {
        method_name: "ft_transfer_call",
        args: b64({ receiver_id: escrow, amount: "1", msg: JSON.stringify({ kind: "fund_batch" }) }),
        deposit: "1",
        gas: "150000000000000",
      },
    ],
  },
});

let routerUrl = "";
let nextKind: object = kindFor(d.usdc);
const router = Fastify();

beforeAll(async () => {
  router.post("/batches/:id/proposal", async () => ({
    contractId: d.dao,
    method: "add_proposal",
    args: { proposal: { description: "Elivo payout batch d-1: x", kind: nextKind } },
    depositYocto: "1000000000000000000000000",
    gasTgas: 100,
    kind: nextKind,
  }));
  await router.listen({ host: "127.0.0.1", port: 0 });
  const a = router.server.address();
  routerUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => router.close());

function signer(stored: object = kindFor(d.usdc)) {
  const calls: Array<{ contractId: string; method: string; args: object; opts: object }> = [];
  const council = {
    accountId: d.council,
    async call(contractId: string, method: string, args: object, opts: object) {
      calls.push({ contractId, method, args, opts });
      return { txHash: `tx-${method}`, logs: [], value: method === "add_proposal" ? 7 : undefined };
    },
  };
  const view = async <T>(_c: string, method: string): Promise<T> => {
    if (method === "get_proposal") return { id: 7, kind: stored, status: "InProgress" } as T;
    throw new Error(method);
  };
  return { app: createDemoSigner({ council, view, d, routerUrl }), calls };
}

describe("demo signer", () => {
  it("labels itself", async () => {
    const r = await signer().app.inject({ method: "GET", url: "/" });
    expect(r.json()).toEqual({ label: "Demo signer: local sandbox keys, not a wallet", account: d.council });
  });

  it("adds the router's funding proposal with its bond", async () => {
    nextKind = kindFor(d.usdc);
    const { app, calls } = signer();
    const r = await app.inject({ method: "POST", url: "/add_proposal", payload: { draft_id: "d-1" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ proposal_id: 7, tx: "tx-add_proposal" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      contractId: d.dao,
      method: "add_proposal",
      args: { proposal: { kind: nextKind } },
      opts: { gasTgas: 100, depositYocto: 1_000_000_000_000_000_000_000_000n },
    });
  });

  it("refuses a proposal that calls another contract", async () => {
    nextKind = kindFor("evil.t");
    const { app, calls } = signer();
    const r = await app.inject({ method: "POST", url: "/add_proposal", payload: { draft_id: "d-1" } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: "not_an_elivo_funding_proposal" });
    expect(calls).toHaveLength(0);
  });

  it("approves with the stored proposal kind", async () => {
    const stored = kindFor(d.usdc);
    const { app, calls } = signer(stored);
    const r = await app.inject({ method: "POST", url: "/approve", payload: { proposal_id: 7 } });
    expect(r.statusCode).toBe(200);
    expect(calls[0]).toMatchObject({
      contractId: d.dao,
      method: "act_proposal",
      args: { id: 7, action: "VoteApprove", proposal: stored },
      opts: { gasTgas: 300 },
    });
  });

  it("refuses to approve a transfer to anyone but the escrow", async () => {
    const { app, calls } = signer(kindFor(d.usdc, "thief.t"));
    const r = await app.inject({ method: "POST", url: "/approve", payload: { proposal_id: 7 } });
    expect(r.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
