/**
 * Server-side view of how this web server was started. `pnpm dev` passes the deployment in
 * ELIVO_DEPLOYMENT_JSON plus the router (ROUTER_URL). With nothing set — a public host — the app is the
 * read-only testnet site: the built-in testnet deployment, no router, no signer.
 */
import type { Deployment } from "@elivo/shared/config";
import { TESTNET_DEPLOYMENT } from "./testnet-deployment.ts";

export function deployment(): Deployment {
  const raw = process.env.ELIVO_DEPLOYMENT_JSON;
  return raw ? (JSON.parse(raw) as Deployment) : (TESTNET_DEPLOYMENT as unknown as Deployment);
}

export function rpcUrl(): string {
  return process.env.NEAR_RPC_URL ?? deployment().rpcUrl;
}

export function routerAvailable(): boolean {
  return !!process.env.ROUTER_URL;
}

/** Nav links: "New batch" needs the router, so a read-only site leaves it out. */
export function navLinks(withRouter: boolean): Array<{ href: string; label: string }> {
  return [
    ...(withRouter ? [{ href: "/new", label: "New batch" }] : []),
    { href: "/firms", label: "Firms" },
    { href: "/verify", label: "Verify" },
  ];
}
