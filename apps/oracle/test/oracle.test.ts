import { keyFromSeed, verify } from "@elivo/shared/keys";
import { exclusionMessage, proofMessage } from "@elivo/shared/messages";
import { describe, expect, it } from "vitest";
import { createOracle, type OracleDeps } from "../src/oracle.ts";

const ESCROW = "escrow.test.near";
const key = keyFromSeed(new Uint8Array(32).fill(1));

function setup(order: { firm_id: string; state: string; excluded: boolean } | null) {
  const proofs: Array<{ json: Record<string, string | number>; sig: string }> = [];
  const exclusions: Array<{ json: Record<string, string | number>; sig: string }> = [];
  let n = 0n;
  const deps: OracleDeps = {
    escrowId: ESCROW,
    key,
    nowNs: async () => 1_731_300_000_000_000_000n,
    lookupOrder: async () => order,
    submitProof: async (json, sig) => {
      proofs.push({ json: json as never, sig });
    },
    submitExclusion: async (json, sig) => {
      exclusions.push({ json: json as never, sig });
    },
    nonce: () => ++n,
  };
  return { app: createOracle(deps), proofs, exclusions };
}

const assigned = { firm_id: "mx1.test.near", state: "Assigned", excluded: false };
const body = { batch_id: "7", payout_id: 2, firm_id: "mx1.test.near" };

describe("oracle", () => {
  it("signs proof for current firm", async () => {
    const { app, proofs } = setup(assigned);
    const res = await app.inject({ method: "POST", url: "/deliveries", payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().proof_ref).toMatch(/^CEP-SIM-7-2-[0-9a-f]{4}$/);
    const { json, sig } = proofs[0];
    expect(json.delivered_at_ns).toBe("1731300000000000000");
    const msg = proofMessage(ESCROW, {
      batch_id: 7n,
      payout_id: 2,
      firm_id: "mx1.test.near",
      delivered_at_ns: 1_731_300_000_000_000_000n,
      proof_ref: String(json.proof_ref),
      nonce: BigInt(json.nonce as string),
    });
    expect(verify(key.publicKey, msg, Buffer.from(sig, "base64"))).toBe(true);
  });

  it("refuses non-current firm", async () => {
    const { app, proofs } = setup(assigned);
    const res = await app.inject({
      method: "POST",
      url: "/deliveries",
      payload: { ...body, firm_id: "mx3.test.near" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_current_firm" });
    expect(proofs).toHaveLength(0);
  });

  it("refuses excluded, settled or missing orders", async () => {
    for (const order of [{ ...assigned, excluded: true }, { ...assigned, state: "Delivered" }, null]) {
      const { app, proofs } = setup(order);
      const res = await app.inject({ method: "POST", url: "/deliveries", payload: body });
      expect(res.statusCode).toBe(409);
      expect(proofs).toHaveLength(0);
    }
  });

  it("signs exclusion with reason 1", async () => {
    const { app, exclusions } = setup(assigned);
    const res = await app.inject({
      method: "POST",
      url: "/exclusions",
      payload: { ...body, reason: "ACCOUNT_CLOSED" },
    });
    expect(res.statusCode).toBe(200);
    const { json, sig } = exclusions[0];
    expect(json.reason_code).toBe(1);
    const msg = exclusionMessage(ESCROW, {
      batch_id: 7n,
      payout_id: 2,
      firm_id: "mx1.test.near",
      reason_code: 1,
      observed_at_ns: BigInt(json.observed_at_ns as string),
      nonce: BigInt(json.nonce as string),
    });
    expect(verify(key.publicKey, msg, Buffer.from(sig, "base64"))).toBe(true);
  });

  it("rejects other reasons", async () => {
    const { app, exclusions } = setup(assigned);
    const res = await app.inject({
      method: "POST",
      url: "/exclusions",
      payload: { ...body, reason: "BANK_OUTAGE" },
    });
    expect(res.statusCode).toBe(400);
    expect(exclusions).toHaveLength(0);
  });

  it("nonces are unique across 1000 calls with the default generator", async () => {
    const seen = new Set<string>();
    const deps: OracleDeps = {
      escrowId: ESCROW,
      key,
      nowNs: async () => 1n,
      lookupOrder: async () => assigned,
      submitProof: async (json) => {
        seen.add(String((json as { nonce: string }).nonce));
      },
      submitExclusion: async () => {},
    };
    const app = createOracle(deps);
    for (let i = 0; i < 1000; i++) await app.inject({ method: "POST", url: "/deliveries", payload: body });
    expect(seen.size).toBe(1000);
  });

  it("serves the label at /", async () => {
    const { app } = setup(assigned);
    expect((await app.inject({ method: "GET", url: "/" })).json().label).toMatch(/Testnet prototype/);
  });
});
