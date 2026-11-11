/**
 * Simulated proof oracle. It signs a delivery proof (in the shape of a CEP receipt reference)
 * or an ACCOUNT_CLOSED exclusion, but only for the firm currently assigned to an open payout.
 * It holds no account and calls no contract; the router submits what it signs.
 */
import { randomBytes } from "node:crypto";
import { type Ed25519Key, sign } from "@elivo/shared/keys";
import {
  exclusionMessage,
  exclusionToJson,
  proofMessage,
  proofToJson,
  REASON_ACCOUNT_CLOSED,
  randomNonce,
} from "@elivo/shared/messages";
import { LABEL } from "@elivo/shared/receipt";
import Fastify, { type FastifyInstance } from "fastify";

export interface Order {
  firm_id: string;
  state: string;
  excluded: boolean;
}

export interface OracleDeps {
  escrowId: string;
  key: Ed25519Key;
  nowNs: () => Promise<bigint>;
  lookupOrder: (batchId: bigint, payoutId: number) => Promise<Order | null>;
  submitProof: (proofJson: object, sigB64: string) => Promise<void>;
  submitExclusion: (exclusionJson: object, sigB64: string) => Promise<void>;
  nonce?: () => bigint;
}

interface DeliveryBody {
  batch_id: string;
  payout_id: number;
  firm_id: string;
  reason?: string;
}

const bodySchema = {
  type: "object",
  required: ["batch_id", "payout_id", "firm_id"],
  properties: {
    batch_id: { type: "string", pattern: "^\\d+$" },
    payout_id: { type: "integer", minimum: 0 },
    firm_id: { type: "string", minLength: 2 },
    reason: { type: "string" },
  },
} as const;

export function createOracle(deps: OracleDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const nonce = deps.nonce ?? randomNonce;
  const b64 = (sig: Uint8Array) => Buffer.from(sig).toString("base64");

  async function currentFirm(b: DeliveryBody): Promise<boolean> {
    const order = await deps.lookupOrder(BigInt(b.batch_id), b.payout_id);
    return !!order && order.state === "Assigned" && !order.excluded && order.firm_id === b.firm_id;
  }

  app.get("/", async () => ({ service: "oracle", label: LABEL }));

  app.post<{ Body: DeliveryBody }>("/deliveries", { schema: { body: bodySchema } }, async (req, reply) => {
    const b = req.body;
    if (!(await currentFirm(b))) return reply.code(409).send({ error: "not_current_firm" });
    const proof = {
      batch_id: BigInt(b.batch_id),
      payout_id: b.payout_id,
      firm_id: b.firm_id,
      delivered_at_ns: await deps.nowNs(),
      proof_ref: `CEP-SIM-${b.batch_id}-${b.payout_id}-${randomBytes(2).toString("hex")}`,
      nonce: nonce(),
    };
    await deps.submitProof(proofToJson(proof), b64(sign(deps.key, proofMessage(deps.escrowId, proof))));
    return { proof_ref: proof.proof_ref };
  });

  app.post<{ Body: DeliveryBody }>("/exclusions", { schema: { body: bodySchema } }, async (req, reply) => {
    const b = req.body;
    if (b.reason !== "ACCOUNT_CLOSED") return reply.code(400).send({ error: "bad_reason" });
    if (!(await currentFirm(b))) return reply.code(409).send({ error: "not_current_firm" });
    const x = {
      batch_id: BigInt(b.batch_id),
      payout_id: b.payout_id,
      firm_id: b.firm_id,
      reason_code: REASON_ACCOUNT_CLOSED,
      observed_at_ns: await deps.nowNs(),
      nonce: nonce(),
    };
    await deps.submitExclusion(exclusionToJson(x), b64(sign(deps.key, exclusionMessage(deps.escrowId, x))));
    return { reason: "ACCOUNT_CLOSED" };
  });

  return app;
}
