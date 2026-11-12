import { describe, expect, it } from "vitest";
import { councilOf, findProposalForDraft } from "../src/dao.ts";

const prop = (id: number, draft: string, status = "InProgress") => ({
  id,
  proposer: "c.test",
  description: `Elivo payout batch ${draft}: 5 payouts, 9022.50 USDC (testnet prototype)`,
  kind: { FunctionCall: { receiver_id: "usdc.test", actions: [] } },
  status,
  votes: {},
});

function fakeView(last: number, proposals: object[], seen: Array<{ method: string; args?: object }> = []) {
  return async <T>(_c: string, method: string, args?: object): Promise<T> => {
    seen.push({ method, args });
    if (method === "get_last_proposal_id") return last as T;
    if (method === "get_proposals") return proposals as T;
    throw new Error(`unexpected ${method}`);
  };
}

describe("findProposalForDraft", () => {
  it("returns the newest matching proposal", async () => {
    const p = await findProposalForDraft(
      fakeView(3, [prop(0, "d-1"), prop(1, "d-1", "Approved"), prop(2, "x")]),
      "dao",
      "d-1",
    );
    expect(p).toMatchObject({ id: 1, status: "Approved", proposer: "c.test" });
    expect(p?.kind).toEqual({ FunctionCall: { receiver_id: "usdc.test", actions: [] } });
  });

  it("does not match d-1 when asked for d-10", async () => {
    expect(await findProposalForDraft(fakeView(1, [prop(0, "d-1")]), "dao", "d-10")).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    expect(await findProposalForDraft(fakeView(0, []), "dao", "d-1")).toBeNull();
  });

  it("reads the last 50 proposals, from index 0 when there are fewer", async () => {
    const seen: Array<{ method: string; args?: object }> = [];
    await findProposalForDraft(fakeView(3, [], seen), "dao", "d-1");
    expect(seen.find((s) => s.method === "get_proposals")?.args).toEqual({ from_index: 0, limit: 50 });
    const seen2: Array<{ method: string; args?: object }> = [];
    await findProposalForDraft(fakeView(120, [], seen2), "dao", "d-1");
    expect(seen2.find((s) => s.method === "get_proposals")?.args).toEqual({ from_index: 70, limit: 50 });
  });
});

describe("councilOf", () => {
  it("lists only accounts in group roles that may approve a function-call proposal", () => {
    const policy = {
      roles: [
        { name: "all", kind: "Everyone", permissions: ["*:AddProposal"] },
        { name: "council", kind: { Group: ["c.test"] }, permissions: ["*:AddProposal", "*:VoteApprove"] },
        { name: "calls", kind: { Group: ["k.test"] }, permissions: ["call:VoteApprove"] },
        { name: "admins", kind: { Group: ["a.test"] }, permissions: ["*:*"] },
        { name: "proposers", kind: { Group: ["p.test"] }, permissions: ["*:AddProposal"] },
        { name: "transfers", kind: { Group: ["t.test"] }, permissions: ["transfer:VoteApprove"] },
      ],
    };
    expect(councilOf(policy).sort()).toEqual(["a.test", "c.test", "k.test"]);
  });
});
