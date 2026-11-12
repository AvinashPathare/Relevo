/**
 * Full batch on a local sandbox: CSV → Sputnik proposal + vote → assignments → MX-3 late and
 * rerouted with a penalty → closed account excluded and refunded → receipt signed and anchored.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirm } from "@elivo/firm-sim/firm";
import { createOracle, type Order } from "@elivo/oracle/oracle";
import { clabeLast4 } from "@elivo/shared/clabe";
import { formatUsdc } from "@elivo/shared/money";
import { type LocalStack, startLocalStack } from "@elivo/shared/testing/localstack";
import type { PayoutView } from "@elivo/shared/views";
import { buildStatus, loadChainViews, type RouterBatchStatus } from "@elivo/web/lib/status";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine, httpFirmClient } from "../src/engine.ts";
import { createRouterServer } from "../src/server.ts";
import { Store } from "../src/store.ts";

const S = 1_000_000_000n;
const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");
const closed: string[] = JSON.parse(
  readFileSync(new URL("../../firm-sim/closed-accounts.json", import.meta.url), "utf8"),
);

let stack: LocalStack;
let engine: Engine;
const apps: FastifyInstance[] = [];
let ticker: NodeJS.Timeout | undefined;
let routerUrl = "";
let mkEngine: (store: Store) => Engine;
const storeFile = join(mkdtempSync(join(tmpdir(), "elivo-e2e-")), "router.json");

async function listen(app: FastifyInstance): Promise<string> {
  apps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return `http://127.0.0.1:${addr.port}`;
}

async function post(url: string, body: object) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} ${r.status} ${await r.text()}`);
  return r.json();
}

beforeAll(async () => {
  console.error("[e2e] starting local stack");
  stack = await startLocalStack();
  console.error("[e2e] stack up");
  const { chain, deployment: d, keys } = stack;
  mkEngine = (store: Store) =>
    new Engine({
      chain,
      router: chain.signer(d.router, keys.routerFc),
      escrowId: d.escrow,
      store,
      firms: [],
      firmClient: httpFirmClient,
      graceNs: 5n * S,
      receiptKey: keys.receipt,
      network: "sandbox",
      log: (msg, data) => console.error(`[engine] ${msg} ${JSON.stringify(data ?? {})}`),
      proposal: { daoId: d.dao, usdcId: d.usdc, cutoffInS: 40, deadlineInS: 300 },
    });
  engine = mkEngine(new Store(storeFile));
  routerUrl = await listen(createRouterServer(engine));
  const oracleUrl = await listen(
    createOracle({
      escrowId: d.escrow,
      key: keys.oracle,
      nowNs: () => chain.blockTimeNs(),
      lookupOrder: async (b, p) => {
        const r = await fetch(`${routerUrl}/orders/${b}/${p}`);
        return r.ok ? ((await r.json()) as Order) : null;
      },
      submitProof: async (proof, sig) => void (await post(`${routerUrl}/proofs`, { proof, oracle_sig: sig })),
      submitExclusion: async (exclusion, sig) =>
        void (await post(`${routerUrl}/exclusions`, { exclusion, oracle_sig: sig })),
    }),
  );
  const firmUrls: Array<{ id: string; url: string }> = [];
  for (const [n, bps, mode] of [
    ["mx1", 22, "ok"],
    ["mx2", 20, "ok"],
    ["mx3", 18, "late"],
  ] as const) {
    const url = await listen(
      createFirm({
        firmId: d.firms[n],
        escrowId: d.escrow,
        key: keys[n],
        quoteBps: bps,
        mode,
        graceMs: 5_000,
        closedClabes: new Set(closed),
        oracle: {
          deliver: async (b) => void (await post(`${oracleUrl}/deliveries`, b)),
          exclude: async (b) => void (await post(`${oracleUrl}/exclusions`, b)),
        },
      }),
    );
    firmUrls.push({ id: d.firms[n], url });
  }
  engine.setFirms(firmUrls);
  let busy = false;
  ticker = setInterval(async () => {
    if (busy) return;
    busy = true;
    await engine.tick();
    busy = false;
  }, 1_000);
});

afterAll(async () => {
  clearInterval(ticker);
  for (const a of apps) await a.close();
  await stack?.stop();
});

describe("full payout flow on the sandbox", () => {
  let payouts: PayoutView[] = [];
  let batchId = "";

  it("validates, proposes, votes, and runs the batch to completion", async () => {
    const { chain, deployment: d, keys } = stack;
    const v = (await (
      await fetch(`${routerUrl}/batches/validate`, {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: csv,
      })
    ).json()) as { ok: boolean; draft_id: string; total_locked: string };
    expect(v.ok).toBe(true);
    expect(v.total_locked).toBe("9022500000");
    const p = (await post(`${routerUrl}/batches/${v.draft_id}/proposal`, {})) as {
      contractId: string;
      args: object;
      depositYocto: string;
      kind: object;
    };
    const council = chain.signer(d.council, keys.council);
    const added = await council.call(d.dao, "add_proposal", p.args, {
      gasTgas: 100,
      depositYocto: BigInt(p.depositYocto),
    });
    const id = Number(added.value);
    console.error(`[e2e] proposal ${id} added`);
    await council.call(
      d.dao,
      "act_proposal",
      { id, action: "VoteApprove", proposal: p.kind },
      { gasTgas: 300 },
    );

    const deadline = Date.now() + 240_000;
    let status: { onchain?: { id: string; receipt_hash: string | null }; payouts?: PayoutView[] } = {};
    while (Date.now() < deadline) {
      status = await (await fetch(`${routerUrl}/batches/${v.draft_id}`)).json();
      console.error(`[e2e] states ${(status.payouts ?? []).map((x) => x.state).join(",")}`);
      if (status.onchain?.receipt_hash) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(status.onchain?.receipt_hash).toBeTruthy();
    payouts = status.payouts ?? [];
    batchId = status.onchain?.id ?? "";
    expect(payouts.every((x) => x.state === "Delivered" || x.state === "Refunded")).toBe(true);
  });

  it("(a) refunds exactly the closed account, in full and without penalty", () => {
    const refunded = payouts.filter((x) => x.state === "Refunded");
    expect(refunded.map((x) => x.id)).toEqual([2]);
    expect(refunded[0]).toMatchObject({ excluded: true, penalties_total: "0" });
  });

  it("(b) has an on-time delivery by a firm other than MX-3", () => {
    const mx3 = stack.deployment.firms.mx3;
    expect(payouts.some((x) => x.state === "Delivered" && x.firms_tried.length === 1 && x.firm !== mx3)).toBe(
      true,
    );
  });

  it("(c) reroutes away from MX-3 and charges its bond", () => {
    const mx3 = stack.deployment.firms.mx3;
    const rerouted = payouts.filter((x) => x.firms_tried[0] === mx3 && x.firms_tried.length >= 2);
    expect(rerouted.length).toBeGreaterThan(0);
    for (const x of rerouted) expect(BigInt(x.penalties_total)).toBeGreaterThan(0n);
  });

  it("(d) reroutes within 10 seconds of the cut-off", () => {
    expect(engine.reroutes.length).toBeGreaterThan(0);
    for (const r of engine.reroutes) expect(r.included_by_ns - r.cutoff_ns).toBeLessThanOrEqual(10n * S);
  });

  it("(e) verify-receipt --chain prints OK", async () => {
    const r = await (await fetch(`${routerUrl}/batches/${engine.draftIdFor(batchId)}/receipt`)).json();
    const file = join(mkdtempSync(join(tmpdir(), "elivo-flow-")), "receipt.json");
    writeFileSync(file, JSON.stringify(r));
    const out = execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "packages/shared/src/bin/verify-receipt.ts",
        file,
        "--chain",
        "--rpc",
        stack.deployment.rpcUrl,
        "--escrow",
        stack.deployment.escrow,
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("OK");
  });

  it("(f) the DAO ends with what it did not pay to firms, plus the penalties", async () => {
    const { chain, deployment: d } = stack;
    const paid = payouts
      .filter((x) => x.state === "Delivered")
      .reduce((s, x) => s + BigInt(x.amount) + (BigInt(x.amount) * BigInt(x.quote_bps)) / 10_000n, 0n);
    const penalties = payouts.reduce((s, x) => s + BigInt(x.penalties_total), 0n);
    expect(penalties).toBeGreaterThan(0n);
    const bal = BigInt(await chain.view<string>(d.usdc, "ft_balance_of", { account_id: d.dao }));
    expect(bal).toBe(50_000_000_000n - paid + penalties);
  });

  it("(g) no payee name or full CLABE appears in any chain call", () => {
    const all = JSON.stringify(stack.chain.calls);
    for (const line of csv.trim().split("\n").slice(1)) {
      const [name, clabe] = line.split(",");
      expect(all).not.toContain(name);
      expect(all).not.toContain(clabe);
    }
  });

  it("(h) F13: after a router reload, the status model equals the contract views", async () => {
    const { deployment: d } = stack;
    const reloaded = await listen(createRouterServer(mkEngine(new Store(storeFile))));
    const draftId = engine.draftIdFor(batchId);
    const overlay = (await (await fetch(`${reloaded}/batches/${draftId}`)).json()) as RouterBatchStatus;
    const views = await loadChainViews(d.escrow, batchId, { rpcUrl: stack.chain.opts.rpcUrl });
    const names = { [d.firms.mx1]: "MX-1", [d.firms.mx2]: "MX-2", [d.firms.mx3]: "MX-3" };
    const model = buildStatus(views, overlay, names);
    expect(model.found).toBe(true);
    expect(model.receiptHash).toBe(views.batch?.receipt_hash);
    expect(model.rows).toHaveLength(views.payouts.length);
    for (const v of views.payouts) {
      const row = model.rows.find((r) => r.id === v.id);
      expect(row?.state).toBe(v.state);
      expect(row?.penalty).toBe(formatUsdc(BigInt(v.penalties_total)));
      expect(row?.route).toBe(v.firms_tried.map((f) => names[f]).join(" → "));
    }
    const rows = csv
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(","));
    expect(model.rows.map((r) => r.payee)).toEqual(
      rows.map(([name, clabe]) => `${name} ****${clabeLast4(clabe)}`),
    );
  });
});
