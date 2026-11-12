"use client";
/**
 * Wallet Selector core with MyNearWallet and our own button (modal-ui pins React 18). Meteor is left out:
 * its SDK imports `utils` from near-api-js, which near-api-js 7 no longer exports.
 */
import { actionCreators } from "@near-js/transactions";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import type { WalletPort } from "./signer.ts";
import type { TxSpec } from "./txs.ts";

let selector: Promise<WalletSelector> | null = null;

function getSelector(): Promise<WalletSelector> {
  selector ??= setupWalletSelector({
    network: "testnet",
    modules: [setupMyNearWallet()],
  });
  return selector;
}

export const WALLETS = [{ id: "my-near-wallet", name: "MyNearWallet" }] as const;

export async function walletPort(): Promise<WalletPort> {
  const s = await getSelector();
  return {
    accountId: () => s.store.getState().accounts.find((a) => a.active)?.accountId ?? null,
    signIn: async (walletId) => {
      const w = await s.wallet(walletId);
      // Browser wallets take optional params; the union type wants hardware-wallet fields too.
      await (w.signIn as (p: object) => Promise<unknown>)({});
    },
    send: async (tx: TxSpec) => {
      const w = await s.wallet();
      await w.signAndSendTransaction({
        receiverId: tx.receiverId,
        actions: tx.actions.map((a) =>
          actionCreators.functionCall(
            a.params.methodName,
            a.params.args,
            BigInt(a.params.gas),
            BigInt(a.params.deposit),
          ),
        ),
      });
    },
  };
}

export async function signOut(): Promise<void> {
  const s = await getSelector();
  if (s.isSignedIn()) await (await s.wallet()).signOut();
}
