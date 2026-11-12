import { describe, expect, it } from "vitest";
import { type Draft, Store } from "../src/store.ts";

const draft = (): Draft => ({
  id: "d-1",
  salt_hex: "00",
  rows: [],
  amounts_usdc: ["1"],
  batch_hash: "aa",
  created_at: "2026-11-12T00:00:00Z",
  txs: {},
  exclusion_reasons: {},
});

describe("Store.addTx", () => {
  it("records a transaction once, however often it is reported", () => {
    const s = new Store(null);
    s.put(draft());
    s.addTx("d-1", 0, "refund", "H1");
    s.addTx("d-1", 0, "refund", "H1");
    s.addTx("d-1", 0, "refund", "H2");
    expect(s.get("d-1")?.txs[0].refund).toEqual(["H1", "H2"]);
  });
});
