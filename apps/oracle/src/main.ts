/** Oracle process: ORACLE_SECRET_KEY, ESCROW_ID, ROUTER_URL, NEAR_RPC_URL, ORACLE_PORT. */
import { Chain } from "@elivo/shared/chain";
import { env } from "@elivo/shared/config";
import { keyFromSecret } from "@elivo/shared/keys";
import { createOracle, type Order } from "./oracle.ts";

const e = env();
const need = (k: string) => process.env[k] ?? (console.error(`missing ${k}`), process.exit(2));
const router = need("ROUTER_URL");
const chain = new Chain({ rpcUrl: e.rpcUrl, network: e.network, fallbackRpcUrls: e.rpcFallbacks });

async function post(path: string, body: object) {
  const r = await fetch(`${router}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
}

const app = createOracle({
  escrowId: need("ESCROW_ID"),
  key: keyFromSecret(need("ORACLE_SECRET_KEY")),
  nowNs: () => chain.blockTimeNs(),
  lookupOrder: async (b, p) => {
    const r = await fetch(`${router}/orders/${b}/${p}`, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? ((await r.json()) as Order) : null;
  },
  submitProof: (proof, sig) => post("/proofs", { proof, oracle_sig: sig }),
  submitExclusion: (exclusion, sig) => post("/exclusions", { exclusion, oracle_sig: sig }),
});
await app.listen({ host: "127.0.0.1", port: e.oraclePort });
console.log(`oracle listening on 127.0.0.1:${e.oraclePort}`);
