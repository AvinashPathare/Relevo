import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Scoreboard } from "../components/Scoreboard.tsx";

afterEach(cleanup);

it("renders one line per firm", () => {
  render(
    <Scoreboard
      rows={[
        {
          name: "MX-1",
          bond: "1000000000",
          approved: true,
          score: {
            firm: "mx1",
            onTime: 3,
            late: 0,
            onTimeRate: 1,
            penaltiesPaid: "0",
            volume: "3600000000",
            reroutedAway: 0,
          },
        },
        {
          name: "MX-3",
          bond: "250000000",
          approved: true,
          score: {
            firm: "mx3",
            onTime: 0,
            late: 1,
            onTimeRate: 0,
            penaltiesPaid: "500000",
            volume: "1000000000",
            reroutedAway: 0,
          },
        },
      ]}
      exposureMultiple={20}
    />,
  );
  expect(
    screen.getByText("MX-1 · on time 3/3 (100%) · penalties 0.00 USDC · volume 3,600.00 USDC"),
  ).toBeTruthy();
  expect(
    screen.getByText("MX-3 · on time 0/1 (0%) · penalties 0.50 USDC · volume 1,000.00 USDC"),
  ).toBeTruthy();
  expect(screen.getByText(/Recomputed from events in the test suite/)).toBeTruthy();
});

it("shows max open exposure with the contract's exposure multiple", () => {
  render(
    <Scoreboard
      exposureMultiple={10}
      rows={[
        {
          name: "MX-2",
          bond: "1000000000",
          approved: true,
          score: {
            firm: "mx2",
            onTime: 0,
            late: 0,
            onTimeRate: null,
            penaltiesPaid: "0",
            volume: "0",
            reroutedAway: 0,
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("Bond 1,000.00 USDC · max open exposure 10,000.00 USDC (10× bond)")).toBeTruthy();
});
