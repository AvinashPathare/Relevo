/** Deployment file and environment configuration (defaults match the spec's demo settings). */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_MXN_PER_USDC } from "./money.ts";

export type Network = "sandbox" | "testnet";

export interface Deployment {
  network: Network;
  rpcUrl: string;
  usdc: string;
  escrow: string;
  router: string;
  firms: { mx1: string; mx2: string; mx3: string };
  council: string;
  dao: string;
}

export function loadDeployment(path: string): Deployment {
  return JSON.parse(readFileSync(path, "utf8")) as Deployment;
}

export function saveDeployment(path: string, d: Deployment): void {
  writeFileSync(path, `${JSON.stringify(d, null, 2)}\n`);
}

export interface Env {
  network: Network;
  rpcUrl: string;
  /** Extra RPC URLs to rotate through on rate limits (testnet public RPCs throttle). */
  rpcFallbacks: string[];
  routerPort: number;
  oraclePort: number;
  firmPorts: { mx1: number; mx2: number; mx3: number };
  graceMs: number;
  pollMs: number;
  cutoffInS: number;
  deadlineInS: number;
  mxnPerUsdc: string;
}

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export function env(e: NodeJS.ProcessEnv = process.env): Env {
  const network = (e.ELIVO_NETWORK as Network) ?? "sandbox";
  return {
    network,
    rpcUrl:
      e.NEAR_RPC_URL ?? (network === "testnet" ? "https://rpc.testnet.near.org" : "http://127.0.0.1:3030"),
    rpcFallbacks: (
      e.NEAR_RPC_FALLBACKS ??
      (network === "testnet" ? "https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org" : "")
    )
      .split(",")
      .filter(Boolean),
    routerPort: num(e.ROUTER_PORT, 7400),
    oraclePort: num(e.ORACLE_PORT, 7410),
    firmPorts: { mx1: num(e.MX1_PORT, 7421), mx2: num(e.MX2_PORT, 7422), mx3: num(e.MX3_PORT, 7423) },
    graceMs: num(e.GRACE_MS, 5_000),
    pollMs: num(e.POLL_MS, network === "testnet" ? 4_000 : 1_000),
    cutoffInS: num(e.CUTOFF_IN_S, network === "testnet" ? 120 : 40),
    deadlineInS: num(e.DEADLINE_IN_S, 300),
    mxnPerUsdc: e.MXN_PER_USDC ?? DEFAULT_MXN_PER_USDC,
  };
}
