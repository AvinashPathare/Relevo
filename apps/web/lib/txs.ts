/** The two DAO transactions a wallet signs, as plain FunctionCall specs (wallet.ts converts them). */
export interface FunctionCallSpec {
  type: "FunctionCall";
  params: { methodName: string; args: object; gas: string; deposit: string };
}

export interface TxSpec {
  receiverId: string;
  actions: FunctionCallSpec[];
}

const TGAS = 1_000_000_000_000n;

export function addProposalTx(p: {
  contractId: string;
  args: object;
  depositYocto: string;
  gasTgas: number;
}): TxSpec {
  return {
    receiverId: p.contractId,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "add_proposal",
          args: p.args,
          gas: (BigInt(p.gasTgas) * TGAS).toString(),
          deposit: p.depositYocto,
        },
      },
    ],
  };
}

export function approveTx(dao: string, id: number, kind: object): TxSpec {
  return {
    receiverId: dao,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "act_proposal",
          args: { id, action: "VoteApprove", proposal: kind },
          gas: (300n * TGAS).toString(),
          deposit: "0",
        },
      },
    ],
  };
}
