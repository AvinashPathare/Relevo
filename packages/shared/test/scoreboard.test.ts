import { describe, expect, it } from "vitest";
import type { ElivoEvent } from "../src/events.ts";
import { scoreboardFromEvents, scoreboardFromFirms } from "../src/scoreboard.ts";
import type { FirmView } from "../src/views.ts";

const ev = (event: string, data: Record<string, unknown>): ElivoEvent => ({ event, data });
const events: ElivoEvent[] = [
  ev("payout_assigned", { batch_id: "0", payout_id: 0, firm_id: "mx3" }),
  ev("penalty_charged", { batch_id: "0", payout_id: 0, firm_id: "mx3", periods: "1", amount: "900000" }),
  ev("payout_rerouted", { batch_id: "0", payout_id: 0, from_firm: "mx3", to_firm: "mx1" }),
  ev("payout_delivered", { batch_id: "0", payout_id: 0, firm_id: "mx1", on_time: false }),
  ev("payout_assigned", { batch_id: "0", payout_id: 1, firm_id: "mx2" }),
  ev("payout_delivered", { batch_id: "0", payout_id: 1, firm_id: "mx2", on_time: true }),
  ev("bond_posted", { firm_id: "mx2", amount: "5" }),
];
const amounts = { "0:0": "9000000000", "0:1": "2500000000" };

describe("scoreboardFromEvents", () => {
  it("counts deliveries, penalties, volume and reroutes per firm", () => {
    const s = scoreboardFromEvents(events, amounts);
    expect(s.mx1).toEqual({
      firm: "mx1",
      onTime: 0,
      late: 1,
      onTimeRate: 0,
      penaltiesPaid: "0",
      volume: "9000000000",
      reroutedAway: 0,
    });
    expect(s.mx2).toEqual({
      firm: "mx2",
      onTime: 1,
      late: 0,
      onTimeRate: 1,
      penaltiesPaid: "0",
      volume: "2500000000",
      reroutedAway: 0,
    });
    expect(s.mx3).toEqual({
      firm: "mx3",
      onTime: 0,
      late: 0,
      onTimeRate: null,
      penaltiesPaid: "900000",
      volume: "0",
      reroutedAway: 1,
    });
  });

  it("sums penalties as bigint strings", () => {
    const big = "340282366920938463463374607431768211455";
    const s = scoreboardFromEvents([
      ev("penalty_charged", { firm_id: "a", amount: big }),
      ev("penalty_charged", { firm_id: "a", amount: "1" }),
    ]);
    expect(s.a.penaltiesPaid).toBe((BigInt(big) + 1n).toString());
  });
});

describe("scoreboardFromFirms", () => {
  it("maps the contract's counters", () => {
    const f = { delivered_on_time: 3, delivered_late: 1, penalties_paid: "900000", volume: "12" } as FirmView;
    expect(scoreboardFromFirms([["mx1", f]]).mx1).toEqual({
      firm: "mx1",
      onTime: 3,
      late: 1,
      onTimeRate: 0.75,
      penaltiesPaid: "900000",
      volume: "12",
      reroutedAway: 0,
    });
  });
});
