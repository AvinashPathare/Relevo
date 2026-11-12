/**
 * Sandbox-only "demo signer": signs the DAO steps with the local council key so the web app can run
 * without a wallet. It signs exactly two things — add_proposal for an Elivo funding proposal, and
 * VoteApprove on one — and refuses anything else.
 */
import type { ChainAccount } from "@elivo/shared/chain";
import type { Deployment } from "@elivo/shared/config";
import { isElivoFundingKind } from "@elivo/shared/funding-kind";
import Fastify, { type FastifyInstance } from "fastify";

export const DEMO_SIGNER_LABEL = "Demo signer: local sandbox keys, not a wallet";

type View = <T>(contractId: string, method: string, args?: object) => Promise<T>;

export { isElivoFundingKind };

export function createDemoSigner(opts: {
  council: ChainAccount;
  view: View;
  d: Deployment;
  routerUrl: string;
}): FastifyInstance {
  const { council, view, d, routerUrl } = opts;
  const app = Fastify({ logger: false });
  const refuse = { error: "not_an_elivo_funding_proposal" };

  app.get("/", async () => ({ label: DEMO_SIGNER_LABEL, account: council.accountId }));

  app.post<{ Body: { draft_id?: string } }>("/add_proposal", async (req, reply) => {
    const draftId = req.body?.draft_id;
    if (!draftId) return reply.code(400).send({ error: "draft_id_required" });
    const r = await fetch(`${routerUrl}/batches/${encodeURIComponent(draftId)}/proposal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return reply.code(r.status).send(await r.json().catch(() => ({ error: "router_error" })));
    const p = (await r.json()) as {
      contractId: string;
      args: { proposal: { kind: unknown } };
      depositYocto: string;
      gasTgas: number;
    };
    if (p.contractId !== d.dao || !isElivoFundingKind(p.args?.proposal?.kind, d))
      return reply.code(400).send(refuse);
    const res = await council.call(d.dao, "add_proposal", p.args, {
      gasTgas: p.gasTgas,
      depositYocto: BigInt(p.depositYocto),
    });
    return { proposal_id: Number(res.value), tx: res.txHash };
  });

  app.post<{ Body: { proposal_id?: number } }>("/approve", async (req, reply) => {
    const id = Number(req.body?.proposal_id);
    if (!Number.isInteger(id) || id < 0) return reply.code(400).send({ error: "proposal_id_required" });
    const p = await view<{ kind: unknown } | null>(d.dao, "get_proposal", { id });
    if (!p || !isElivoFundingKind(p.kind, d)) return reply.code(400).send(refuse);
    const res = await council.call(
      d.dao,
      "act_proposal",
      { id, action: "VoteApprove", proposal: p.kind },
      { gasTgas: 300 },
    );
    return { tx: res.txHash };
  });

  app.setErrorHandler((err, _req, reply) => {
    reply.code(502).send({ error: "sign_failed", message: String((err as Error).message).slice(0, 300) });
  });

  return app;
}
