/** What the browser needs to know about the deployment, served by /api/config. */
export interface WebConfig {
  network: "sandbox" | "testnet";
  escrow: string;
  dao: string;
  usdc: string;
  council: string;
  router: string;
  firms: { mx1: string; mx2: string; mx3: string };
  signer: "demo" | "wallet";
  routerAvailable: boolean;
  explorer: string | null;
  /** The NEAR RPC the deployment uses (shown in the verify command; the browser itself uses /rpc). */
  rpcUrl: string;
}

export async function fetchConfig(f: typeof fetch = fetch): Promise<WebConfig> {
  const r = await f("/api/config");
  if (!r.ok) throw new Error(`config: HTTP ${r.status}`);
  return (await r.json()) as WebConfig;
}

/** "mx3.pg-1.testnet" → "MX-3"; anything else is returned unchanged. */
export function firmNames(cfg: Pick<WebConfig, "firms">): Record<string, string> {
  return { [cfg.firms.mx1]: "MX-1", [cfg.firms.mx2]: "MX-2", [cfg.firms.mx3]: "MX-3" };
}
