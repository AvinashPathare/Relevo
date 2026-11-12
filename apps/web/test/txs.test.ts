import { describe, expect, it } from "vitest";
import { addProposalTx, approveTx } from "../lib/txs.ts";

describe("wallet transactions", () => {
  it("add_proposal carries the router's args, bond and gas", () => {
    const tx = addProposalTx({
      contractId: "dao.t",
      args: { proposal: { description: "x", kind: { FunctionCall: {} } } },
      depositYocto: "1000000000000000000000000",
      gasTgas: 100,
    });
    expect(tx).toEqual({
      receiverId: "dao.t",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "add_proposal",
            args: { proposal: { description: "x", kind: { FunctionCall: {} } } },
            gas: "100000000000000",
            deposit: "1000000000000000000000000",
          },
        },
      ],
    });
  });

  it("act_proposal passes the stored kind through unchanged", () => {
    const kind = { FunctionCall: { receiver_id: "usdc.t", actions: [{ method_name: "ft_transfer_call" }] } };
    expect(approveTx("dao.t", 3, kind)).toEqual({
      receiverId: "dao.t",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "act_proposal",
            args: { id: 3, action: "VoteApprove", proposal: kind },
            gas: "300000000000000",
            deposit: "0",
          },
        },
      ],
    });
  });
});
