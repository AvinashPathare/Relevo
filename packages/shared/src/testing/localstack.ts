/**
 * Boots a local NEAR sandbox with the whole Payout Guard stack deployed:
 * mock USDC, the escrow (demo mode), a Sputnik DAO v2 (council = 1 member), three approved and
 * bonded firms, and a router function-call key limited to the escrow's router methods.
 * Keys are generated in memory for each stack (nothing written to disk).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nearToYocto, teraToGas } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { Chain } from "../chain.ts";
import type { Deployment } from "../config.ts";
import { type Ed25519Key, keyFromSecret, keyFromSeed } from "../keys.ts";

export const ROUTER_METHODS = ["assign", "reroute", "settle", "exclude", "anchor_receipt", "refund"];
const USDC = 1_000_000n;

export interface StackKeys {
  root: Ed25519Key;
  oracle: Ed25519Key;
  receipt: Ed25519Key;
  routerFc: Ed25519Key;
  /** Firms' quote-signing keys (registered with the escrow). */
  mx1: Ed25519Key;
  mx2: Ed25519Key;
  mx3: Ed25519Key;
  /** Full-access account keys. */
  accounts: Record<string, Ed25519Key>;
  council: Ed25519Key;
}

export interface LocalStack {
  chain: Chain;
  deployment: Deployment;
  keys: StackKeys;
  stop(): Promise<void>;
}

const repo = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));
const freshKey = () => keyFromSeed(randomBytes(32));

export async function startLocalStack(
  opts: { bondsUsdc?: [bigint, bigint, bigint] } = {},
): Promise<LocalStack> {
  const bonds = opts.bondsUsdc ?? [1000n, 250n, 250n];
  const sandbox = await Sandbox.start({});
  try {
    const chain = new Chain({ rpcUrl: sandbox.rpcUrl, network: "sandbox" });
    const rootKey = keyFromSecret(DEFAULT_PRIVATE_KEY);
    const root = chain.account(DEFAULT_ACCOUNT_ID, rootKey);
    const id = (p: string) => `${p}.${DEFAULT_ACCOUNT_ID}`;

    const accounts: Record<string, Ed25519Key> = {};
    const funding: Record<string, `${number}`> = {
      usdc: "10",
      escrow: "20",
      router: "5",
      mx1: "5",
      mx2: "5",
      mx3: "5",
      council: "20",
      dao: "30",
    };
    for (const [prefix, near] of Object.entries(funding)) {
      const k = freshKey();
      accounts[id(prefix)] = k;
      await root.createSubAccount({
        accountOrPrefix: prefix,
        publicKey: k.publicKeyStr,
        nearToTransfer: nearToYocto(near),
      });
    }
    const as = (prefix: string) => chain.signer(id(prefix), accounts[id(prefix)]);
    const rootSigner = chain.signer(DEFAULT_ACCOUNT_ID, rootKey);

    const keys: StackKeys = {
      root: rootKey,
      oracle: freshKey(),
      receipt: freshKey(),
      routerFc: freshKey(),
      mx1: freshKey(),
      mx2: freshKey(),
      mx3: freshKey(),
      accounts,
      council: accounts[id("council")],
    };
    const d: Deployment = {
      network: "sandbox",
      rpcUrl: sandbox.rpcUrl,
      usdc: id("usdc"),
      escrow: id("escrow"),
      router: id("router"),
      firms: { mx1: id("mx1"), mx2: id("mx2"), mx3: id("mx3") },
      council: id("council"),
      dao: id("dao"),
    };

    const deploy = async (prefix: string, wasmPath: string, args: object) => {
      const acct = chain.account(id(prefix), accounts[id(prefix)]);
      await acct.deployContract(new Uint8Array(readFileSync(wasmPath)));
      await acct.callFunctionRaw({
        contractId: id(prefix),
        methodName: "new",
        args: args as Record<string, unknown>,
        gas: teraToGas(200),
      });
    };
    await deploy("usdc", repo("contracts/res/mock_usdc.wasm"), { owner_id: d.usdc, total_supply: "0" });
    await deploy("escrow", repo("contracts/res/elivo_escrow.wasm"), {
      owner_id: DEFAULT_ACCOUNT_ID,
      token_id: d.usdc,
      router_id: d.router,
      oracle_pk: keys.oracle.publicKeyStr,
      receipt_pk: keys.receipt.publicKeyStr,
      demo_mode: true,
    });
    await deploy("dao", repo(".cache/sputnikdao2.wasm"), {
      config: { name: "elivo-demo", purpose: "Elivo Payout Guard demo (sandbox)", metadata: "" },
      policy: [d.council],
    });

    const tgas = { gasTgas: 50 };
    for (const a of [d.escrow, d.router, d.council, d.dao, d.firms.mx1, d.firms.mx2, d.firms.mx3]) {
      await rootSigner.call(
        d.usdc,
        "storage_deposit",
        { account_id: a },
        { ...tgas, depositYocto: 12_500_000_000_000_000_000_000n },
      );
    }
    const firmKeys = { mx1: keys.mx1, mx2: keys.mx2, mx3: keys.mx3 };
    for (const [i, n] of (["mx1", "mx2", "mx3"] as const).entries()) {
      const firmId = d.firms[n];
      await rootSigner.call(
        d.escrow,
        "storage_deposit",
        { account_id: firmId },
        { ...tgas, depositYocto: 10n ** 23n },
      );
      await as(n).call(d.escrow, "register_firm", { pk: firmKeys[n].publicKeyStr }, tgas);
      await rootSigner.call(d.escrow, "approve_firm", { firm_id: firmId }, { ...tgas, depositYocto: 1n });
      const bond = (bonds[i] * USDC).toString();
      await as("usdc").call(d.usdc, "mint", { account_id: firmId, amount: bond }, tgas);
      await as(n).call(
        d.usdc,
        "ft_transfer_call",
        { receiver_id: d.escrow, amount: bond, msg: JSON.stringify({ kind: "post_bond" }) },
        { gasTgas: 150, depositYocto: 1n },
      );
    }
    await as("usdc").call(d.usdc, "mint", { account_id: d.dao, amount: (50_000n * USDC).toString() }, tgas);
    await rootSigner.call(
      d.escrow,
      "storage_deposit",
      { account_id: d.dao },
      { ...tgas, depositYocto: 10n ** 24n },
    );
    await chain.account(d.router, accounts[d.router]).addFunctionCallAccessKey({
      publicKey: keys.routerFc.publicKeyStr,
      contractId: d.escrow,
      methodNames: ROUTER_METHODS,
      allowance: nearToYocto("1"),
    });
    chain.calls.length = 0; // setup calls are not part of the flow under test

    return { chain, deployment: d, keys, stop: () => sandbox.tearDown() };
  } catch (e) {
    await sandbox.tearDown();
    throw e;
  }
}
