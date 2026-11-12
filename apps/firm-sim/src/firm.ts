/**
 * Simulated payout firm (MX-1..MX-3). It quotes a fixed fee, accepts orders, and "delivers" MXN
 * by asking the oracle for a proof: ok = within seconds, late = after cut-off + grace, fail = never.
 * Closed accounts are never deliverable: the firm reports ACCOUNT_CLOSED instead.
 */
import { type Ed25519Key, sign } from "@elivo/shared/keys";
import { quoteMessage } from "@elivo/shared/messages";
import { LABEL } from "@elivo/shared/receipt";
import Fastify, { type FastifyInstance } from "fastify";

export type Mode = "ok" | "late" | "fail";
const MODES: Mode[] = ["ok", "late", "fail"];

export interface OracleClient {
  deliver(b: { batch_id: string; payout_id: number; firm_id: string }): Promise<void>;
  exclude(b: {
    batch_id: string;
    payout_id: number;
    firm_id: string;
    reason: "ACCOUNT_CLOSED";
  }): Promise<void>;
}

export interface FirmDeps {
  firmId: string;
  escrowId: string;
  key: Ed25519Key;
  quoteBps: number;
  mode: Mode;
  graceMs: number;
  closedClabes: Set<string>;
  oracle: OracleClient;
  schedule?: (ms: number, fn: () => void | Promise<void>) => void;
  random?: () => number;
  log?: (msg: string) => void;
}

interface OrderBody {
  batch_id: string;
  payout_id: number;
  clabe: string;
  amount_mxn: string;
  cutoff_ms: number;
}

export function createFirm(deps: FirmDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  let mode: Mode = deps.mode;
  const schedule = deps.schedule ?? ((ms, fn) => void setTimeout(fn, ms).unref());
  const random = deps.random ?? Math.random;
  const log = deps.log ?? (() => {});

  // Retry when the oracle could not process the request (5xx / network); a refusal (4xx) is final.
  const safely =
    (what: string, fn: () => Promise<void>, left = 5) =>
    async () => {
      try {
        await fn();
      } catch (e) {
        const msg = (e as Error).message;
        if (left > 1 && /\b5\d\d\b|fetch failed|timeout|ECONN/i.test(msg)) {
          log(`${deps.firmId} ${what} failed (${msg.slice(0, 60)}), retrying`);
          schedule(3_000, safely(what, fn, left - 1));
        } else {
          log(`${deps.firmId} ${what} refused: ${msg.slice(0, 120)}`);
        }
      }
    };

  app.get("/", async () => ({ service: "firm-sim", firm_id: deps.firmId, mode, label: LABEL }));

  app.post<{ Body: { batch_id: string; payout_id: number } }>("/quote", async (req) => {
    const { batch_id, payout_id } = req.body;
    const msg = quoteMessage(deps.escrowId, {
      batch_id: BigInt(batch_id),
      payout_id,
      firm_id: deps.firmId,
      quote_bps: deps.quoteBps,
    });
    return {
      firm_id: deps.firmId,
      quote_bps: deps.quoteBps,
      quote_sig: Buffer.from(sign(deps.key, msg)).toString("base64"),
    };
  });

  app.post<{ Body: OrderBody }>("/orders", async (req, reply) => {
    const { batch_id, payout_id, clabe, cutoff_ms } = req.body;
    const ref = { batch_id, payout_id, firm_id: deps.firmId };
    if (deps.closedClabes.has(clabe)) {
      schedule(
        1_500,
        safely("exclusion", () => deps.oracle.exclude({ ...ref, reason: "ACCOUNT_CLOSED" })),
      );
    } else if (mode === "ok") {
      schedule(
        Math.round(2_000 + random() * 2_000),
        safely("delivery", () => deps.oracle.deliver(ref)),
      );
    } else if (mode === "late") {
      schedule(
        cutoff_ms + deps.graceMs + 20_000,
        safely("late delivery", () => deps.oracle.deliver(ref)),
      );
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post<{ Body: { mode: string } }>("/mode", async (req, reply) => {
    if (!MODES.includes(req.body?.mode as Mode)) return reply.code(400).send({ error: "bad_mode" });
    mode = req.body.mode as Mode;
    return { mode };
  });

  return app;
}
