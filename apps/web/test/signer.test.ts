import { describe, expect, it, vi } from "vitest";
import { walletSigner } from "../lib/signer.ts";

const cfg = { dao: "dao.t", usdc: "usdc.t", escrow: "escrow.t" };
const b64 = (o: object) => btoa(JSON.stringify(o));
const funding = {
  FunctionCall: {
    receiver_id: "usdc.t",
    actions: [
      {
        method_name: "ft_transfer_call",
        args: b64({
          receiver_id: "escrow.t",
          amount: "1",
          msg: JSON.stringify({ kind: "fund_batch", batch_hash: "aa" }),
        }),
        deposit: "1",
        gas: "1",
      },
    ],
  },
};
const proposal = (kind: object) => ({ id: 3, status: "InProgress", kind, proposer: "x", votes: {} });

describe("walletSigner.approve", () => {
  it("sends VoteApprove for this app's funding proposal", async () => {
    const send = vi.fn(async () => {});
    await walletSigner({ accountId: () => "c.t", signIn: async () => {}, send }, cfg).approve(
      proposal(funding),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses to sign a vote on any other kind of proposal", async () => {
    const send = vi.fn(async () => {});
    const s = walletSigner({ accountId: () => "c.t", signIn: async () => {}, send }, cfg);
    await expect(s.approve(proposal({ ChangePolicy: { policy: {} } }))).rejects.toThrow(
      /not this app's funding proposal/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
