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

describe("Chain timeouts", () => {
  it("times out a hung view and retries it", async () => {
    let n = 0;
    const provider = {
      callFunction: () => {
        n++;
        return n === 1 ? new Promise(() => {}) : Promise.resolve("ok");
      },
    };
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: provider as never,
      retryDelayMs: 1,
      timeoutMs: 20,
    });
    expect(await chain.view<string>("c", "m")).toBe("ok");
    expect(n).toBe(2);
  });

  it("times out a hung block query", async () => {
    const provider = { viewBlock: () => new Promise(() => {}) };
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: provider as never,
      timeoutMs: 20,
      retryDelayMs: 1,
    });
    await expect(chain.blockTimeNs()).rejects.toThrow(/timeout/);
  });
});

describe("Chain endpoint rotation", () => {
  it("moves to the next RPC endpoint after a rate limit", async () => {
    const used: string[] = [];
    const mk = (name: string, fail: boolean) => ({
      callFunction: async () => {
        used.push(name);
        if (fail) throw new Error("-429 Rate limits exceeded");
        return name;
      },
    });
    const chain = new Chain({
      rpcUrl: "http://a",
      network: "testnet",
      providers: [mk("a", true), mk("b", false)] as never,
      retryDelayMs: 1,
    });
    expect(await chain.view<string>("c", "m")).toBe("b");
    expect(used).toEqual(["a", "b"]);
    expect(await chain.view<string>("c", "m")).toBe("b"); // stays on the healthy endpoint
  });

  it("retries a rate-limited block query", async () => {
    let n = 0;
    const provider = {
      viewBlock: async () => {
        if (++n === 1) throw new Error("-429 Rate limits exceeded");
        return { header: { timestamp_nanosec: "7" } };
      },
    };
    const chain = new Chain({
      rpcUrl: "http://x",
      network: "testnet",
      provider: provider as never,
      retryDelayMs: 1,
    });
    expect(await chain.blockTimeNs()).toBe(7n);
  });
});
