import { describe, expect, it } from "vitest";
import { fundingConfigMismatch, isElivoFundingKind } from "../src/funding-kind.ts";

const d = { usdc: "usdc.t", escrow: "escrow.t" };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
const kind = (
  over: {
    receiver?: string;
    escrow?: string;
    hash?: string;
    actions?: number;
    method?: string;
    router?: string;
    oracle?: string;
  } = {},
) => ({
  FunctionCall: {
    receiver_id: over.receiver ?? d.usdc,
    actions: Array.from({ length: over.actions ?? 1 }, () => ({
      method_name: over.method ?? "ft_transfer_call",
      args: b64({
        receiver_id: over.escrow ?? d.escrow,
        amount: "1",
        msg: JSON.stringify({
          kind: "fund_batch",
          batch_hash: over.hash ?? "aa",
          router_id: over.router ?? "router.t",
          oracle_pk: over.oracle ?? "ed25519:ORACLE",
        }),
      }),
      deposit: "1",
      gas: "1",
    })),
  },
});

describe("isElivoFundingKind", () => {
  it("accepts this app's funding proposal", () => {
    expect(isElivoFundingKind(kind(), d)).toBe(true);
    expect(isElivoFundingKind(kind(), d, "aa")).toBe(true);
  });
  it("rejects another batch when a batch hash is given", () => {
    expect(isElivoFundingKind(kind({ hash: "bb" }), d, "aa")).toBe(false);
  });
  it("rejects other contracts, receivers, methods and extra actions", () => {
    expect(isElivoFundingKind(kind({ receiver: "evil.t" }), d)).toBe(false);
    expect(isElivoFundingKind(kind({ escrow: "thief.t" }), d)).toBe(false);
    expect(isElivoFundingKind(kind({ method: "ft_transfer" }), d)).toBe(false);
    expect(isElivoFundingKind(kind({ actions: 2 }), d)).toBe(false);
  });
  it("rejects other proposal kinds and malformed args", () => {
    expect(isElivoFundingKind({ ChangePolicy: { policy: {} } }, d)).toBe(false);
    expect(isElivoFundingKind({ Transfer: { receiver_id: "x", amount: "1" } }, d)).toBe(false);
    expect(
      isElivoFundingKind(
        {
          FunctionCall: { receiver_id: d.usdc, actions: [{ method_name: "ft_transfer_call", args: "%%%" }] },
        },
        d,
      ),
    ).toBe(false);
    expect(isElivoFundingKind(null, d)).toBe(false);
  });
});

describe("fundingConfigMismatch", () => {
  const live = { router_id: "router.t", oracle_pk: "ed25519:ORACLE" };
  it("is null when the proposal names the escrow's live router and oracle key", () => {
    expect(fundingConfigMismatch(kind(), d, live)).toBeNull();
  });
  it("names the field that differs from the live config", () => {
    expect(fundingConfigMismatch(kind({ router: "old-router.t" }), d, live)).toBe("router_id");
    expect(fundingConfigMismatch(kind({ oracle: "ed25519:OLD" }), d, live)).toBe("oracle_pk");
  });
  it("reports a kind that is not a funding proposal", () => {
    expect(fundingConfigMismatch({ ChangePolicy: {} }, d, live)).toBe("kind");
  });
});
