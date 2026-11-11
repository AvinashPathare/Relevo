/**
 * Router process. Env: DEPLOYMENT (path to deployment JSON), ROUTER_FC_SECRET_KEY,
 * RECEIPT_SECRET_KEY, MX1_URL/MX2_URL/MX3_URL, plus config.ts env (ports, grace, poll, network).
 */
import { Chain } from "@elivo/shared/chain";
import { env, loadDeployment } from "@elivo/shared/config";
import { keyFromSecret } from "@elivo/shared/keys";
import { Engine, httpFirmClient } from "./engine.ts";
import { createRouterServer } from "./server.ts";
import { Store } from "./store.ts";

const e = env();
const need = (k: string) => process.env[k] ?? (console.error(`missing ${k}`), process.exit(2));
const d = loadDeployment(need("DEPLOYMENT"));
const chain = new Chain({
  rpcUrl: process.env.NEAR_RPC_URL ?? d.rpcUrl,
  network: d.network,
  fallbackRpcUrls: e.rpcFallbacks,
});
const firmUrls: Record<string, string> = {
  [d.firms.mx1]: need("MX1_URL"),
  [d.firms.mx2]: need("MX2_URL"),
  [d.firms.mx3]: need("MX3_URL"),
};
const engine = new Engine({
  chain,
  router: chain.signer(d.router, keyFromSecret(need("ROUTER_FC_SECRET_KEY"))),
  escrowId: d.escrow,
  store: new Store(process.env.ROUTER_STORE ?? `.data/router-${d.network}.json`),
  firms: Object.entries(firmUrls).map(([id, url]) => ({ id, url })),
  firmClient: httpFirmClient,
  graceNs: BigInt(e.graceMs) * 1_000_000n,
  receiptKey: keyFromSecret(need("RECEIPT_SECRET_KEY")),
  network: d.network,
  proposal: { daoId: d.dao, usdcId: d.usdc, cutoffInS: e.cutoffInS, deadlineInS: e.deadlineInS },
  log: (msg, data) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...data })),
});
const app = createRouterServer(engine, {
  rate: e.mxnPerUsdc,
  firmUrls: { mx1: firmUrls[d.firms.mx1], mx2: firmUrls[d.firms.mx2], mx3: firmUrls[d.firms.mx3] },
});
await app.listen({ host: "127.0.0.1", port: e.routerPort });
console.log(`router listening on 127.0.0.1:${e.routerPort}`);

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  await engine.tick();
  busy = false;
}, e.pollMs);
