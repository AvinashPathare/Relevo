/** One interface for the two ways the DAO steps get signed: a wallet (testnet) or the sandbox demo signer. */
import { isElivoFundingKind } from "@elivo/shared/funding-kind";
import type { DaoProposal } from "./dao.ts";
import { addProposalTx, approveTx, type TxSpec } from "./txs.ts";

export interface Signer {
  mode: "demo" | "wallet";
  accountId: string | null;
  signIn(walletId?: string): Promise<void>;
  propose(draftId: string): Promise<void>;
  approve(proposal: DaoProposal): Promise<void>;
}

async function postJson(url: string, body: object): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (j as { error?: string; message?: string }).message ??
        (j as { error?: string }).error ??
        `HTTP ${r.status}`,
    );
  return j;
}

export function demoSigner(accountId: string): Signer {
  return {
    mode: "demo",
    accountId,
    signIn: async () => {},
    propose: async (draftId) => void (await postJson("/demo-signer/add_proposal", { draft_id: draftId })),
    approve: async (p) => void (await postJson("/demo-signer/approve", { proposal_id: p.id })),
  };
}

/** What walletSigner needs from Wallet Selector (kept narrow so wallet.ts owns the library). */
export interface WalletPort {
  accountId(): string | null;
  signIn(walletId: string): Promise<void>;
  send(tx: TxSpec): Promise<void>;
}

export function walletSigner(port: WalletPort, cfg: { dao: string; usdc: string; escrow: string }): Signer {
  const { dao } = cfg;
  return {
    mode: "wallet",
    accountId: port.accountId(),
    signIn: (walletId = "my-near-wallet") => port.signIn(walletId),
    propose: async (draftId) => {
      const p = (await postJson(`/router/batches/${encodeURIComponent(draftId)}/proposal`, {})) as {
        contractId: string;
        args: object;
        depositYocto: string;
        gasTgas: number;
      };
      if (p.contractId !== dao) throw new Error("proposal is not for this DAO");
      await port.send(addProposalTx(p));
    },
    approve: async (proposal) => {
      // Anyone can add a proposal to a Sputnik DAO; never vote on one this app didn't build.
      if (!isElivoFundingKind(proposal.kind, cfg))
        throw new Error(`Proposal #${proposal.id} is not this app's funding proposal`);
      await port.send(approveTx(dao, proposal.id, proposal.kind));
    },
  };
}
