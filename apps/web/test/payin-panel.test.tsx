import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PAYIN_LABEL, PayinResult } from "../components/PayinPanel.tsx";

afterEach(cleanup);

it("shows the quote line and the illustration label", () => {
  render(
    <PayinResult
      totalLockedUnits="9022500000"
      quote={{
        ok: true,
        asset: "nep141:eth.omft.near",
        symbol: "ETH",
        chain: "Ethereum",
        amountIn: "0.049173284692011877",
        amountInUsd: "101.218780942884",
        amountOut: "9022.5",
        timeEstimateS: 45,
        appFeeBps: 20,
      }}
    />,
  );
  expect(
    screen.getByText(
      "≈ 0.0492 ETH on Ethereum (≈ $101.22) to deliver 9,022.50 USDC on NEAR · ~45 s · 1Click app fee 20 bps",
    ),
  ).toBeTruthy();
  expect(screen.getByText(PAYIN_LABEL)).toBeTruthy();
});

it("shows why a quote is unavailable", () => {
  render(<PayinResult totalLockedUnits="1" quote={{ ok: false, reason: "timeout" }} />);
  expect(screen.getByText("Pay-in quote unavailable: timeout")).toBeTruthy();
});
