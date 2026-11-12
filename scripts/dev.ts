/**
 * pnpm dev          → web app + router + oracle + firm sims on a local sandbox, with the demo signer
 * pnpm dev:testnet  → the same against deployments/testnet.json; DAO steps are signed with a wallet
 * pnpm web:testnet  → read-only web app against testnet (no keys, no router): /chain/<id>, /firms
 *
 * Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env, loadDeployment } from "@elivo/shared/config";
import { LABEL } from "@elivo/shared/receipt";
import { createDemoSigner, DEMO_SIGNER_LABEL } from "./lib/demo-signer.ts";
import { onStop, startCommand, stopAll, waitHealthy } from "./lib/procs.ts";
import { setupSandbox, setupTestnet, startServices } from "./lib/stack.ts";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const network = arg("--network") ?? "sandbox";
const readOnly = process.argv.includes("--read-only");
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const SIGNER_PORT = Number(process.env.DEMO_SIGNER_PORT ?? 7430);
const e = env({ ...process.env, ELIVO_NETWORK: network });

function startWeb(webEnv: Record<string, string>) {
  startCommand(
    "web",
    "pnpm",
    ["exec", "next", "dev", "--port", String(WEB_PORT)],
    webEnv,
    resolve("apps/web"),
  );
  return waitHealthy(`http://127.0.0.1:${WEB_PORT}/api/config`, 120_000);
}

async function main() {
  console.log(`\nElivo Payout Guard — web app on ${network}${readOnly ? " (read-only)" : ""}\n${LABEL}\n`);
  if (readOnly) {
    const depFile = resolve("deployments/testnet.json");
    const d = loadDeployment(depFile);
    await startWeb({
      ELIVO_NETWORK: "testnet",
      ELIVO_DEPLOYMENT_JSON: JSON.stringify(d),
      NEAR_RPC_URL: process.env.NEAR_RPC_URL ?? d.rpcUrl,
    });
    console.log(
      `Open http://localhost:${WEB_PORT}/chain/5 (the reference run) or /firms. No keys or router needed.`,
    );
  } else {
    const s = network === "testnet" ? await setupTestnet() : await setupSandbox();
    onStop(s.stop);
    const routerStore = network === "testnet" ? ".data/router-testnet-dev.json" : undefined;
    const { urls, depFile } = await startServices(s, network, e, { routerStore });
    const webEnv: Record<string, string> = {
      ELIVO_NETWORK: network,
      ELIVO_DEPLOYMENT_JSON: readFileSync(depFile, "utf8"),
      NEAR_RPC_URL: s.chain.opts.rpcUrl,
      ROUTER_URL: urls.router,
    };
    if (network === "sandbox") {
      const signer = createDemoSigner({
        council: s.chain.signer(s.d.council, s.keys.council),
        view: s.chain.view.bind(s.chain),
        d: s.d,
        routerUrl: urls.router,
      });
      await signer.listen({ host: "127.0.0.1", port: SIGNER_PORT });
      onStop(() => signer.close());
      webEnv.DEMO_SIGNER_URL = `http://127.0.0.1:${SIGNER_PORT}`;
      console.log(`${DEMO_SIGNER_LABEL} (council ${s.d.council})`);
    }
    await startWeb(webEnv);
    console.log(
      "Services: router, proof oracle, firms MX-1, MX-2, MX-3 (MX-3 is configured to be late). Logs in .data/logs/",
    );
    console.log(`Open http://localhost:${WEB_PORT}/new`);
  }
  console.log("Ctrl-C to stop.\n");
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`dev failed: ${(err as Error).message}`);
  stopAll();
  process.exit(1);
});
