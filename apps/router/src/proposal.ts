/** Sputnik DAO v2 FunctionCall proposal that funds a batch via USDC ft_transfer_call. */
import { formatUsdc, lockedFor } from "@elivo/shared/money";
import type { Draft } from "./store.ts";

export interface ProposalConfig {
  daoId: string;
  usdcId: string;
  escrowId: string;
  routerId: string;
  oraclePk: string;
  cutoffInNs: bigint;
  deadlineInNs: bigint;
  proposalBondYocto: string;
}

export interface FundingProposal {
  contractId: string;
  method: "add_proposal";
  args: { proposal: { description: string; kind: object } };
  depositYocto: bigint;
  gasTgas: number;
  kind: object;
}

export function fundMsg(draft: Draft, cfg: ProposalConfig): string {
  return JSON.stringify({
    kind: "fund_batch",
    batch_hash: draft.batch_hash,
    router_id: cfg.routerId,
    oracle_pk: cfg.oraclePk,
    payouts: draft.amounts_usdc.map((amount, id) => ({
      id,
      amount,
      cutoff_in_ns: cfg.cutoffInNs.toString(),
      deadline_in_ns: cfg.deadlineInNs.toString(),
    })),
  });
}

export function buildFundingProposal(draft: Draft, cfg: ProposalConfig): FundingProposal {
  const total = draft.amounts_usdc.reduce((s, a) => s + lockedFor(BigInt(a)), 0n);
  const args = { receiver_id: cfg.escrowId, amount: total.toString(), msg: fundMsg(draft, cfg) };
  const kind = {
    FunctionCall: {
      receiver_id: cfg.usdcId,
      actions: [
        {
          method_name: "ft_transfer_call",
          args: Buffer.from(JSON.stringify(args)).toString("base64"),
          deposit: "1",
          gas: "150000000000000",
        },
      ],
    },
  };
  const description = `Elivo payout batch ${draft.id}: ${draft.amounts_usdc.length} payouts, ${formatUsdc(total)} USDC (testnet prototype)`;
  return {
    contractId: cfg.daoId,
    method: "add_proposal",
    args: { proposal: { description, kind } },
    depositYocto: BigInt(cfg.proposalBondYocto),
    gasTgas: 100,
    kind,
  };
}
