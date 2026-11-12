import { describe, expect, it } from "vitest";
import { env } from "../src/config.ts";

describe("env defaults", () => {
  it("uses FastNEAR on testnet (rpc.testnet.near.org is deprecated)", () => {
    const e = env({ ELIVO_NETWORK: "testnet" });
    expect(e.rpcUrl).toBe("https://test.rpc.fastnear.com");
    expect(e.cutoffInS).toBe(120);
    expect(e.pollMs).toBe(4_000);
  });
  it("uses the local sandbox by default", () => {
    expect(env({}).rpcUrl).toBe("http://127.0.0.1:3030");
  });
});
