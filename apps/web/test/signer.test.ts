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
          msg: JSON.stringify({
            kind: "fund_batch",
            batch_hash: "aa",
            router_id: "router.t",
            oracle_pk: "ed25519:ORACLE",
          }),
        }),
        deposit: "1",
        gas: "1",
      },
    ],
  },
};
const proposal = (kind: object) => ({ id: 3, status: "InProgress", kind, proposer: "x", votes: {} });
/** Escrow get_config as the wallet signer reads it before a vote. */
const liveView =
  (live = { router_id: "router.t", oracle_pk: "ed25519:ORACLE" }) =>
  async <T>(_c: string, method: string): Promise<T> => {
    if (method === "get_config") return live as T;
    throw new Error(method);
  };

describe("walletSigner.approve", () => {
  it("sends VoteApprove for this app's funding proposal", async () => {
    const send = vi.fn(async () => {});
    await walletSigner({ accountId: () => "c.t", signIn: async () => {}, send }, cfg, liveView()).approve(
      proposal(funding),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses to sign a vote on any other kind of proposal", async () => {
    const send = vi.fn(async () => {});
    const s = walletSigner({ accountId: () => "c.t", signIn: async () => {}, send }, cfg, liveView());
    await expect(s.approve(proposal({ ChangePolicy: { policy: {} } }))).rejects.toThrow(
      /not this app's funding proposal/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a vote the escrow would turn into 'approved, never funded'", async () => {
    const send = vi.fn(async () => {});
    const s = walletSigner(
      { accountId: () => "c.t", signIn: async () => {}, send },
      cfg,
      liveView({ router_id: "new-router.t", oracle_pk: "ed25519:ORACLE" }),
    );
    await expect(s.approve(proposal(funding))).rejects.toThrow(
      "Proposal #3 names a router_id the escrow no longer uses: the escrow would refuse the funding",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
