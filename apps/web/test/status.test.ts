import { describe, expect, it } from "vitest";
import { buildStatus } from "../lib/status.ts";
import { FIRMS, overlay, payout, S, terminalPayouts, views } from "./fixtures.ts";

const label = (p: Parameters<typeof payout>[1], nowNs?: bigint) =>
  buildStatus(views([payout(0, p)]), null, FIRMS, nowNs).rows[0].label;

describe("buildStatus labels", () => {
  it("Delivered on time", () => {
    expect(
      label({ state: "Delivered", firm: "mx1.t", firms_tried: ["mx1.t"], delivered_at_ns: String(120n * S) }),
    ).toBe("Delivered on time by MX-1");
  });
  it("Delivered after reroute", () => {
    expect(
      label({
        state: "Delivered",
        firm: "mx2.t",
        firms_tried: ["mx3.t", "mx2.t"],
        delivered_at_ns: String(150n * S),
      }),
    ).toBe("Delivered after reroute by MX-2");
  });
  it("Delivered late without a reroute", () => {
    expect(
      label({ state: "Delivered", firm: "mx2.t", firms_tried: ["mx2.t"], delivered_at_ns: String(150n * S) }),
    ).toBe("Delivered late by MX-2 (penalty charged)");
  });
  it("Refunded after an exclusion", () => {
    expect(label({ state: "Refunded", excluded: true, firms_tried: ["mx2.t"] })).toBe(
      "Refunded: account closed (no penalty)",
    );
  });
  it("Refunded at the deadline", () => {
    expect(label({ state: "Refunded", firms_tried: ["mx3.t"] })).toBe("Refunded: deadline passed");
  });
  it("Rerouted and still assigned", () => {
    expect(label({ state: "Assigned", firm: "mx1.t", firms_tried: ["mx3.t", "mx1.t"] })).toBe(
      "Rerouted: MX-3 missed its cut-off, now with MX-1",
    );
  });
  it("Assigned with a cut-off countdown", () => {
    expect(label({ state: "Assigned", firm: "mx3.t", firms_tried: ["mx3.t"] }, 128n * S)).toBe(
      "Assigned to MX-3, cut-off in 12 s",
    );
    expect(label({ state: "Assigned", firm: "mx3.t", firms_tried: ["mx3.t"] }, 150n * S)).toBe(
      "Assigned to MX-3, cut-off passed",
    );
    expect(label({ state: "Assigned", firm: "mx3.t", firms_tried: ["mx3.t"] })).toBe("Assigned to MX-3");
  });
  it("Account closed, refund pending", () => {
    expect(label({ state: "Assigned", firm: "mx2.t", firms_tried: ["mx2.t"], excluded: true })).toBe(
      "Account closed: refund pending",
    );
  });
  it("Waiting for a firm", () => {
    expect(label({})).toBe("Waiting for a firm");
  });
});

describe("buildStatus model", () => {
  it("shows the route a payout took", () => {
    expect(buildStatus(views(), null, FIRMS).rows[1].route).toBe("MX-3 → MX-1");
  });

  it("sums totals as bigint, counting a refund's locked amount", () => {
    const m = buildStatus(views(), null, FIRMS);
    expect(m.totals).toEqual({
      locked: "10,025.00",
      delivered: "8,000.00",
      refunded: "2,005.00",
      penalties: "0.90",
    });
  });

  it("names payees only from the router overlay, with the last 4 digits", () => {
    expect(buildStatus(views(), null, FIRMS).rows[0].payee).toBeNull();
    const m = buildStatus(views(), overlay, FIRMS);
    expect(m.rows[0].payee).toBe("Lucía Fernández ****7771");
    expect(m.rows[0].txs).toEqual([{ kind: "assign", hash: "tx-assign-0", url: null }]);
  });

  it("reports a missing batch as not found", () => {
    const m = buildStatus(views([], null), null, FIRMS);
    expect(m.found).toBe(false);
    expect(m.rows).toEqual([]);
  });

  it("is terminal only when every payout is Delivered or Refunded", () => {
    expect(buildStatus(views(), null, FIRMS).terminal).toBe(true);
    const open = [
      ...terminalPayouts.slice(0, 4),
      payout(4, { state: "Assigned", firm: "mx2.t", firms_tried: ["mx2.t"] }),
    ];
    expect(buildStatus(views(open), null, FIRMS).terminal).toBe(false);
    expect(buildStatus(views([]), null, FIRMS).terminal).toBe(false);
  });

  it("carries the receipt hash and the paused flag", () => {
    const m = buildStatus(views(), null, FIRMS);
    expect(m).toMatchObject({
      found: true,
      batchId: "5",
      funder: "dao.t",
      receiptHash: "HASH",
      anchored: true,
      paused: false,
    });
  });
});
