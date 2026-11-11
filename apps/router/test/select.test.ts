import type { PayoutView } from "@elivo/shared/views";
import { describe, expect, it } from "vitest";
import { decide, pickFirm } from "../src/select.ts";

const quotes = [
  { firm_id: "mx1", quote_bps: 22, quote_sig: "a" },
  { firm_id: "mx2", quote_bps: 20, quote_sig: "b" },
  { firm_id: "mx3", quote_bps: 18, quote_sig: "c" },
];
const firm = (bond: bigint, open = 0n, approved = true) => ({ bond, open_exposure: open, approved });
const firms = { mx1: firm(1000n), mx2: firm(250n), mx3: firm(250n) };

describe("pickFirm", () => {
  it("cheapest eligible wins", () => expect(pickFirm(quotes, firms, [], 100n)?.firm_id).toBe("mx3"));
  it("skips firms over capacity", () => {
    expect(pickFirm(quotes, { ...firms, mx3: firm(250n, 4_900n) }, [], 200n)?.firm_id).toBe("mx2");
    expect(pickFirm(quotes, firms, [], 5_000n)?.firm_id).toBe("mx3");
    expect(pickFirm(quotes, firms, [], 5_001n)?.firm_id).toBe("mx1");
  });
  it("skips tried and unapproved firms", () => {
    expect(pickFirm(quotes, firms, ["mx3"], 100n)?.firm_id).toBe("mx2");
    expect(pickFirm(quotes, { ...firms, mx3: firm(250n, 0n, false) }, [], 100n)?.firm_id).toBe("mx2");
  });
  it("returns null when nobody is eligible", () =>
    expect(pickFirm(quotes, firms, ["mx1", "mx2", "mx3"], 1n)).toBeNull());
  it("breaks ties by firm id", () => {
    const tie = [
      { firm_id: "mxB", quote_bps: 20, quote_sig: "" },
      { firm_id: "mxA", quote_bps: 20, quote_sig: "" },
    ];
    expect(pickFirm(tie, { mxA: firm(10n), mxB: firm(10n) }, [], 1n)?.firm_id).toBe("mxA");
  });
});

const view = (over: Partial<PayoutView>): PayoutView => ({
  batch_id: "0",
  id: 0,
  amount: "1",
  locked: "1",
  state: "Assigned",
  firm: "mx3",
  quote_bps: 18,
  cutoff_ns: "1000",
  final_deadline_ns: "5000",
  penalties_total: "0",
  firms_tried: ["mx3"],
  excluded: false,
  delivered_at_ns: null,
  proof_ref: null,
  ...over,
});

describe("decide", () => {
  const g = 100n;
  it("assigns funded payouts before the cut-off only", () => {
    expect(decide(view({ state: "Funded", firm: null }), 999n, g)).toBe("assign");
    expect(decide(view({ state: "Funded", firm: null }), 1000n, g)).toBe("wait");
  });
  it("reroutes strictly after cut-off + grace", () => {
    expect(decide(view({}), 1100n, g)).toBe("wait");
    expect(decide(view({}), 1101n, g)).toBe("reroute");
  });
  it("refunds strictly after the final deadline", () => {
    expect(decide(view({}), 5000n, g)).toBe("wait");
    expect(decide(view({}), 5001n, g)).toBe("refund");
    expect(decide(view({ state: "Funded", firm: null }), 5001n, g)).toBe("refund");
  });
  it("refunds excluded payouts at once", () =>
    expect(decide(view({ excluded: true }), 1n, g)).toBe("refund"));
  it("is done with terminal payouts", () => {
    expect(decide(view({ state: "Delivered" }), 9999n, g)).toBe("done");
    expect(decide(view({ state: "Refunded" }), 9999n, g)).toBe("done");
  });
});
