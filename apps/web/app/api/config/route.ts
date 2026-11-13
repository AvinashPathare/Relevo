import type { WebConfig } from "../../../lib/config.ts";
import { deployment, routerAvailable, rpcUrl } from "../../../lib/deployment.ts";

export const dynamic = "force-dynamic";

/**
 * The deployment comes from ELIVO_DEPLOYMENT_JSON (set by scripts/dev.ts), or is the built-in testnet
 * deployment when nothing is set (the public read-only site). The web app reads no files: in dev,
 * Turbopack treats a dynamic filesystem read as a dependency on the whole repo.
 */
export function GET(): Response {
  const d = deployment();
  const cfg: WebConfig = {
    network: d.network,
    escrow: d.escrow,
    dao: d.dao,
    usdc: d.usdc,
    council: d.council,
    router: d.router,
    firms: d.firms,
    signer: d.network === "sandbox" && process.env.DEMO_SIGNER_URL ? "demo" : "wallet",
    routerAvailable: routerAvailable(),
    explorer: d.network === "testnet" ? "https://testnet.nearblocks.io" : null,
    rpcUrl: rpcUrl(),
  };
  return Response.json(cfg);
}
