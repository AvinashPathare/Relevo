import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainCallError } from "../src/chain.ts";
import { parseElivoEvents } from "../src/events.ts";
import { type LocalStack, startLocalStack } from "../src/testing/localstack.ts";
import type { ConfigView, FirmView } from "../src/views.ts";

let stack: LocalStack;
beforeAll(async () => {
  stack = await startLocalStack();
});
afterAll(async () => {
  await stack?.stop();
});

describe("local stack", () => {
  it("deploys the escrow with the router and oracle", async () => {
    const cfg = await stack.chain.view<ConfigView>(stack.deployment.escrow, "get_config");
    expect(cfg.router_id).toBe(stack.deployment.router);
    expect(cfg.oracle_pk).toBe(stack.keys.oracle.publicKeyStr);
    expect(cfg.period_ns).toBe("10000000000");
  });

  it("registers, approves and bonds the three firms", async () => {
    const firms = await stack.chain.view<[string, FirmView][]>(stack.deployment.escrow, "list_firms");
    const byId = Object.fromEntries(firms);
    const { mx1, mx2, mx3 } = stack.deployment.firms;
    expect([byId[mx1].bond, byId[mx2].bond, byId[mx3].bond]).toEqual([
      "1000000000",
      "250000000",
      "250000000",
    ]);
    expect(firms.every(([, f]) => f.approved)).toBe(true);
    expect(byId[mx3].pk).toBe(stack.keys.mx3.publicKeyStr);
  });

  it("funds the DAO with mock USDC", async () => {
    const bal = await stack.chain.view<string>(stack.deployment.usdc, "ft_balance_of", {
      account_id: stack.deployment.dao,
    });
    expect(bal).toBe("50000000000");
  });

  it("lets the router's function-call key reach escrow router methods", async () => {
    const router = stack.chain.signer(stack.deployment.router, stack.keys.routerFc);
    const err = await router
      .call(stack.deployment.escrow, "refund", { batch_id: "99", payout_id: 0 }, { gasTgas: 30 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ChainCallError);
    expect((err as ChainCallError).panic).toBe("unknown_batch");
  });

  it("rejects the function-call key for owner methods", async () => {
    const router = stack.chain.signer(stack.deployment.router, stack.keys.routerFc);
    await expect(
      router.call(stack.deployment.escrow, "set_paused", { paused: true }, { gasTgas: 30 }),
    ).rejects.toThrow();
  });

  it("returns logs and tx hashes, and records calls", async () => {
    const council = stack.chain.signer(stack.deployment.council, stack.keys.council);
    const r = await council.call(
      stack.deployment.escrow,
      "storage_deposit",
      {},
      { gasTgas: 30, depositYocto: 10n ** 22n },
    );
    expect(r.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(parseElivoEvents(r.logs)).toEqual([]);
    expect(stack.chain.calls.at(-1)?.method).toBe("storage_deposit");
    expect(await stack.chain.blockTimeNs()).toBeGreaterThan(0n);
  });
});
