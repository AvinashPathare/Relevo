import type { Deployment } from "@elivo/shared/config";
import type { WebConfig } from "../../../lib/config.ts";

export const dynamic = "force-dynamic";

/**
 * The deployment arrives as JSON in ELIVO_DEPLOYMENT_JSON (set by scripts/dev.ts). The web app reads no
 * files: in dev, Turbopack treats a dynamic filesystem read as a dependency on the whole repo, and the
 * services' log writes then trigger an endless reload loop.
 */
export function GET(): Response {
  const raw = process.env.ELIVO_DEPLOYMENT_JSON;
  if (!raw)
    return Response.json({ error: "deployment not configured (start with pnpm dev)" }, { status: 503 });
  const d = JSON.parse(raw) as Deployment;
  const cfg: WebConfig = {
    network: d.network,
    escrow: d.escrow,
    dao: d.dao,
    usdc: d.usdc,
    council: d.council,
    router: d.router,
    firms: d.firms,
    signer: d.network === "sandbox" && process.env.DEMO_SIGNER_URL ? "demo" : "wallet",
    routerAvailable: !!process.env.ROUTER_URL,
    explorer: d.network === "testnet" ? "https://testnet.nearblocks.io" : null,
    rpcUrl: process.env.NEAR_RPC_URL ?? d.rpcUrl,
  };
  return Response.json(cfg);
}
