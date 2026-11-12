/** Shared by make demo and pnpm dev: bring up a sandbox or attach to testnet, then start the services. */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Chain } from "@elivo/shared/chain";
import { type Deployment, type Env, env, loadDeployment, saveDeployment } from "@elivo/shared/config";
import { type Ed25519Key, loadKeyFile } from "@elivo/shared/keys";
import { formatUsdc } from "@elivo/shared/money";
import type { FirmView } from "@elivo/shared/views";
import { startService, waitHealthy } from "./procs.ts";

const short = (id: string | null) => (id ? id.split(".")[0].toUpperCase().replace("MX", "MX-") : "-");
const usdc = (units: string | bigint) => `${formatUsdc(BigInt(units))} USDC`;

export interface Setup {
  chain: Chain;
  d: Deployment;
  keys: {
    oracle: Ed25519Key;
    receipt: Ed25519Key;
    routerFc: Ed25519Key;
    mx1: Ed25519Key;
    mx2: Ed25519Key;
    mx3: Ed25519Key;
    council: Ed25519Key;
  };
  stop: () => Promise<void>;
}

export async function setupSandbox(): Promise<Setup> {
  const { startLocalStack } = await import("@elivo/shared/testing/localstack");
  const s = await startLocalStack();
  return { chain: s.chain, d: s.deployment, keys: s.keys, stop: s.stop };
}

export async function setupTestnet(note: (msg: string) => void = console.log): Promise<Setup> {
  const d = loadDeployment("deployments/testnet.json");
  if (!d.dao) throw new Error("deployments/testnet.json has no dao: run ./scripts/testnet-dao.sh first");
  const chain = new Chain({
    rpcUrl: process.env.NEAR_RPC_URL ?? d.rpcUrl,
    network: "testnet",
    retryDelayMs: 1_000,
    fallbackRpcUrls: env({ ELIVO_NETWORK: "testnet" }).rpcFallbacks,
  });
  const cred = (id: string) => loadKeyFile(join(homedir(), ".near-credentials", "testnet", `${id}.json`));
  const k = (n: string) => loadKeyFile(`.data/keys/${n}.json`);
  // Demo bonds: MX-1 1,000 / MX-2 250 / MX-3 250 USDC, so assignments spread across firms.
  // Trim with withdraw_bond, or top up (mint mock USDC to the firm, then post_bond).
  const firms = Object.fromEntries(await chain.view<Array<[string, FirmView]>>(d.escrow, "list_firms"));
  const targets = [
    ["mx1", 1_000_000_000n],
    ["mx2", 250_000_000n],
    ["mx3", 250_000_000n],
  ] as const;
  for (const [n, target] of targets) {
    const id = d.firms[n];
    const bond = BigInt(firms[id].bond);
    const firm = chain.signer(id, cred(id));
    if (bond > target) {
      await firm.call(d.escrow, "withdraw_bond", { amount: (bond - target).toString() }, { gasTgas: 60 });
    } else if (bond < target) {
      const diff = (target - bond).toString();
      await chain
        .signer(d.usdc, cred(d.usdc))
        .call(d.usdc, "mint", { account_id: id, amount: diff }, { gasTgas: 30 });
      await firm.call(
        d.usdc,
        "ft_transfer_call",
        { receiver_id: d.escrow, amount: diff, msg: JSON.stringify({ kind: "post_bond" }) },
        { gasTgas: 150, depositYocto: 1n },
      );
    }
    if (bond !== target) note(`${short(id)} bond set to ${usdc(target)}`);
  }
  // The router's function-call key pays gas from a fixed allowance; warn before it runs out mid-demo.
  const fc = k("router-fc");
  try {
    const ak = (await chain.provider.viewAccessKey({
      accountId: d.router,
      publicKey: fc.publicKeyStr,
    })) as {
      permission?: { FunctionCall?: { allowance?: string | null } } | string;
    };
    const allowance = typeof ak.permission === "object" ? ak.permission.FunctionCall?.allowance : null;
    if (allowance) {
      const near = Number(BigInt(allowance) / 10n ** 21n) / 1000;
      note(
        `router function-call key allowance left: ${near.toFixed(3)} NEAR${near < 0.1 ? "  ← LOW: re-add the key with a larger allowance" : ""}`,
      );
    }
  } catch (err) {
    note(`could not read the router key's allowance: ${(err as Error).message.slice(0, 80)}`);
  }
  return {
    chain,
    d,
    keys: {
      oracle: k("oracle"),
      receipt: k("receipt"),
      routerFc: k("router-fc"),
      mx1: k("mx1"),
      mx2: k("mx2"),
      mx3: k("mx3"),
      council: cred(d.council),
    },
    stop: async () => {},
  };
}

export interface ServiceUrls {
  router: string;
  oracle: string;
  mx1: string;
  mx2: string;
  mx3: string;
}

/** Starts the oracle, three firm simulators and the router as child processes; waits until healthy. */
export async function startServices(
  s: Setup,
  network: string,
  e: Env,
  opts: { routerStore?: string } = {},
): Promise<{ urls: ServiceUrls; depFile: string }> {
  const { chain, d, keys } = s;
  mkdirSync(".data", { recursive: true });
  const depFile = `.data/deployment-${network}.json`;
  saveDeployment(depFile, d);
  const port = (p: number) => `http://127.0.0.1:${p}`;
  const urls = {
    router: port(e.routerPort),
    oracle: port(e.oraclePort),
    mx1: port(e.firmPorts.mx1),
    mx2: port(e.firmPorts.mx2),
    mx3: port(e.firmPorts.mx3),
  };
  const common = { ELIVO_NETWORK: network, NEAR_RPC_URL: chain.opts.rpcUrl, ESCROW_ID: d.escrow };
  startService("oracle", "apps/oracle/src/main.ts", {
    ...common,
    ROUTER_URL: urls.router,
    ORACLE_SECRET_KEY: keys.oracle.secretKeyStr,
  });
  for (const n of ["mx1", "mx2", "mx3"] as const) {
    startService(n, "apps/firm-sim/src/main.ts", {
      ...common,
      FIRM: n,
      FIRM_ACCOUNT: d.firms[n],
      FIRM_SECRET_KEY: keys[n].secretKeyStr,
      ORACLE_URL: urls.oracle,
    });
  }
  startService("router", "apps/router/src/main.ts", {
    ...common,
    DEPLOYMENT: depFile,
    ROUTER_STORE: opts.routerStore ?? `.data/router-${network}-${Date.now()}.json`,
    ROUTER_FC_SECRET_KEY: keys.routerFc.secretKeyStr,
    RECEIPT_SECRET_KEY: keys.receipt.secretKeyStr,
    MX1_URL: urls.mx1,
    MX2_URL: urls.mx2,
    MX3_URL: urls.mx3,
  });
  for (const u of Object.values(urls)) await waitHealthy(u);
  return { urls, depFile };
}
