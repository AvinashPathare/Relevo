import { describe, expect, it } from "vitest";
import { Chain } from "../src/chain.ts";

function fakeProvider(script: Array<() => unknown>) {
  let i = 0;
  return {
    calls: () => i,
    async callFunction() {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      return step();
    },
  };
}

describe("Chain.view retries", () => {
  it("retries rate limits and network errors, then succeeds", async () => {
    const p = fakeProvider([
      () => {
        throw new Error("Too Many Requests (429)");
      },
      () => {
        throw new Error("fetch failed");
      },
      () => "42",
    ]);
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: p as never,
      retryDelayMs: 1,
    });
    expect(await chain.view<string>("c", "m")).toBe("42");
    expect(p.calls()).toBe(3);
  });

  it("does not retry contract errors", async () => {
    const p = fakeProvider([
      () => {
        throw new Error("Contract panicked: unknown_batch");
      },
    ]);
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: p as never,
      retryDelayMs: 1,
    });
    await expect(chain.view("c", "m")).rejects.toThrow("unknown_batch");
    expect(p.calls()).toBe(1);
  });

  it("gives up after 5 attempts", async () => {
    const p = fakeProvider([
      () => {
        throw new Error("503 Service Unavailable");
      },
    ]);
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: p as never,
      retryDelayMs: 1,
    });
    await expect(chain.view("c", "m")).rejects.toThrow("503");
    expect(p.calls()).toBe(5);
  });
});
