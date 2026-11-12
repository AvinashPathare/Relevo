import { loadDeployment } from "@elivo/shared/config";
import type { WebConfig } from "../../../lib/config.ts";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const file = process.env.DEPLOYMENT;
  if (!file) return Response.json({ error: "DEPLOYMENT not set (start with pnpm dev)" }, { status: 503 });
  const d = loadDeployment(file);
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
  };
  return Response.json(cfg);
}
