/** Router HTTP API (spec §8) plus the internal endpoints the oracle and firm simulators use. */
import { readFileSync } from "node:fs";
import { LABEL } from "@elivo/shared/receipt";
import type { BatchView, PayoutView } from "@elivo/shared/views";
import Fastify, { type FastifyInstance } from "fastify";
import { councilOf, findProposalForDraft } from "./dao.ts";
import type { Engine } from "./engine.ts";
import { createPayinQuoter, PAYIN_ASSETS, type PayinQuoter } from "./payin.ts";
import { validateCsv } from "./validate.ts";

export interface ServerOptions {
  rate?: string;
  firmUrls?: Record<string, string>;
  /** 1Click pay-in quoter (injectable for tests). */
  payin?: PayinQuoter;
}

const bigintSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function createRouterServer(engine: Engine, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const rate = opts.rate ?? "18.50";
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => done(null, body));
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintSafe));

  app.get("/", async () => ({ service: "router", label: LABEL }));

  // The two sample CSVs, for the web app's "Use sample" buttons.
  const SAMPLES = new Set(["payees.csv", "payees-with-error.csv"]);
  app.get<{ Params: { name: string } }>("/samples/:name", async (req, reply) => {
    if (!SAMPLES.has(req.params.name)) return reply.code(404).send({ error: "unknown_sample" });
    const text = readFileSync(new URL(`../../../samples/${req.params.name}`, import.meta.url), "utf8");
    return reply.type("text/csv; charset=utf-8").send(text);
  });

  const payin = opts.payin ?? createPayinQuoter();
  app.get("/quote/assets", async () =>
    Object.entries(PAYIN_ASSETS).map(([id, a]) => ({ id, symbol: a.symbol, chain: a.chain })),
  );
  app.get<{ Querystring: { asset?: string; amount?: string } }>("/quote/payin", async (req, reply) => {
    const { asset = "", amount = "" } = req.query;
    if (!/^[1-9]\d{0,30}$/.test(amount)) return reply.code(400).send({ ok: false, reason: "bad_amount" });
    return payin.quote(asset, amount);
  });

  app.get("/config", async () => ({
    network: engine.network,
    escrow: engine.escrowId,
    rate,
    cutoff_in_s: engine.proposalSettings?.cutoffInS ?? null,
    deadline_in_s: engine.proposalSettings?.deadlineInS ?? null,
    grace_ms: Number(engine.graceNs / 1_000_000n),
    fee_buffer_bps: 25,
  }));

  app.get<{ Params: { id: string } }>("/batches/:id/dao-proposal", async (req, reply) => {
    const draft = engine.store.get(req.params.id);
    if (!draft) return reply.code(404).send({ error: "unknown_draft" });
    const daoId = engine.proposalSettings?.daoId;
    if (!daoId) return reply.code(404).send({ error: "no_dao_configured" });
    const view = engine.chain.view.bind(engine.chain);
    const p = await findProposalForDraft(view, daoId, draft.id);
    if (!p) return reply.code(404).send({ error: "no_proposal" });
    const policy = await view<{ roles?: Array<{ kind: unknown }> }>(daoId, "get_policy");
    return { ...p, council: councilOf(policy) };
  });

  app.post("/batches/validate", async (req, reply) => {
    const body = req.body as string | { csv?: string };
    const text = typeof body === "string" ? body : body?.csv;
    if (!text) return reply.code(400).send({ error: "csv_required" });
    const r = validateCsv(text, rate);
    if (r.draft) engine.store.put(r.draft);
    const { draft, ...rest } = r;
    return reply.code(r.ok ? 200 : 422).send({ ...rest, draft_id: draft?.id, batch_hash: draft?.batch_hash });
  });

  app.post<{ Params: { id: string } }>("/batches/:id/proposal", async (req, reply) => {
    const draft = engine.store.get(req.params.id);
    if (!draft) return reply.code(404).send({ error: "unknown_draft" });
    const p = await engine.proposalFor(draft);
    return { ...p, depositYocto: p.depositYocto.toString() };
  });

  app.get<{ Params: { id: string } }>("/batches/:id", async (req, reply) => {
    const draft = engine.store.get(req.params.id);
    if (!draft) return reply.code(404).send({ error: "unknown_draft" });
    const escrow = engine.escrowId;
    let onchain: BatchView | null = null;
    let payouts: PayoutView[] = [];
    if (draft.onchain_batch_id !== undefined) {
      onchain = await engine.chain.view<BatchView>(escrow, "get_batch", { batch_id: draft.onchain_batch_id });
      payouts = await engine.chain.view<PayoutView[]>(escrow, "get_batch_payouts", {
        batch_id: draft.onchain_batch_id,
      });
    }
    const links = (hashes: string[] = []) =>
      hashes.map((h) => ({ hash: h, url: engine.chain.explorerTx(h) }));
    return {
      draft: {
        id: draft.id,
        batch_hash: draft.batch_hash,
        rows: draft.rows.map((r, i) => ({
          row: r.row,
          name: r.name,
          clabe_last4: r.clabe.slice(-4),
          amount_mxn: r.amount_mxn,
          amount_usdc: draft.amounts_usdc[i],
        })),
      },
      onchain,
      payouts: payouts.map((p) => ({
        ...p,
        txs: Object.fromEntries(Object.entries(draft.txs[p.id] ?? {}).map(([k, v]) => [k, links(v)])),
      })),
      receipt_ready: !!draft.receipt && !!onchain?.receipt_hash,
      anchor_tx: draft.anchor_tx ? links([draft.anchor_tx])[0] : null,
    };
  });

  app.get<{ Params: { id: string } }>("/batches/:id/receipt", async (req, reply) => {
    const draft = engine.store.get(req.params.id);
    if (!draft?.receipt) return reply.code(404).send({ error: "receipt_not_ready" });
    return draft.receipt;
  });

  app.get<{ Params: { batch: string; payout: string } }>("/orders/:batch/:payout", async (req, reply) => {
    const o = await engine.order(req.params.batch, Number(req.params.payout));
    return o ? o : reply.code(404).send({ error: "unknown_payout" });
  });

  app.post<{ Body: { proof: { batch_id: string; payout_id: number }; oracle_sig: string } }>(
    "/proofs",
    async (req, reply) => {
      const r = await engine.submitProof(req.body.proof, req.body.oracle_sig);
      return r.ok ? { ok: true } : reply.code(r.status).send({ error: r.error });
    },
  );

  app.post<{ Body: { exclusion: { batch_id: string; payout_id: number }; oracle_sig: string } }>(
    "/exclusions",
    async (req, reply) => {
      const r = await engine.submitExclusion(req.body.exclusion, req.body.oracle_sig);
      return r.ok ? { ok: true } : reply.code(r.status).send({ error: r.error });
    },
  );

  app.post<{ Params: { id: string }; Body: { mode: string } }>("/sim/firms/:id/mode", async (req, reply) => {
    const url = opts.firmUrls?.[req.params.id];
    if (!url) return reply.code(404).send({ error: "unknown_firm" });
    const r = await fetch(`${url}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    return reply.code(r.status).send(await r.json());
  });

  app.get("/firms", async () => {
    const escrow = engine.escrowId;
    return engine.chain.view(escrow, "list_firms");
  });

  return app;
}
