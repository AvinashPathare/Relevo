import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFundingProposal } from "../src/proposal.ts";
import { validateCsv } from "../src/validate.ts";

const csv = readFileSync(new URL("../../../samples/payees.csv", import.meta.url), "utf8");
const draft = validateCsv(csv, "18.50", () => new Uint8Array(32).fill(1)).draft!;
const cfg = {
  daoId: "dao.test.near",
  usdcId: "usdc.test.near",
  escrowId: "escrow.test.near",
  routerId: "router.test.near",
  oraclePk: "ed25519:4bs14NBauA3z941pmV1XyrMoXZ9qzDB6sDhbB8vLGHNx",
  cutoffInNs: 40_000_000_000n,
  deadlineInNs: 300_000_000_000n,
  proposalBondYocto: "100000000000000000000000",
};

describe("buildFundingProposal", () => {
  const p = buildFundingProposal(draft, cfg);
  const action = (
    p.kind as {
      FunctionCall: {
        receiver_id: string;
        actions: Array<{ args: string; method_name: string; deposit: string; gas: string }>;
      };
    }
  ).FunctionCall;
  const args = JSON.parse(Buffer.from(action.actions[0].args, "base64").toString("utf8"));
  const msg = JSON.parse(args.msg);

  it("targets the DAO with the proposal bond", () => {
    expect(p.contractId).toBe("dao.test.near");
    expect(p.method).toBe("add_proposal");
    expect(p.depositYocto).toBe(100000000000000000000000n);
    expect(p.args.proposal.kind).toBe(p.kind);
    expect(p.args.proposal.description).toMatch(
      /^Elivo payout batch .+: 5 payouts, 9,022.50 USDC \(testnet prototype\)$/,
    );
  });
  it("calls ft_transfer_call on USDC into the escrow for the locked total", () => {
    expect(action.receiver_id).toBe("usdc.test.near");
    expect(action.actions[0]).toMatchObject({
      method_name: "ft_transfer_call",
      deposit: "1",
      gas: "150000000000000",
    });
    expect(args).toMatchObject({ receiver_id: "escrow.test.near", amount: "9022500000" });
  });
  it("pins router and oracle in the funding message", () => {
    expect(msg).toMatchObject({
      kind: "fund_batch",
      batch_hash: draft.batch_hash,
      router_id: cfg.routerId,
      oracle_pk: cfg.oraclePk,
    });
    expect(msg.payouts).toHaveLength(5);
    expect(msg.payouts[2]).toEqual({
      id: 2,
      amount: "1500000000",
      cutoff_in_ns: "40000000000",
      deadline_in_ns: "300000000000",
    });
  });
  it("contains no payee data", () => {
    const all =
      JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + JSON.stringify(args);
    for (const row of draft.rows) {
      expect(all).not.toContain(row.clabe);
      expect(all).not.toContain(row.name);
    }
  });
});
