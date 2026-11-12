import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StatusView } from "../components/StatusView.tsx";
import { buildStatus } from "../lib/status.ts";
import { config, FIRMS, overlay, views } from "./fixtures.ts";

afterEach(cleanup);

const base = { network: "sandbox" as const, escrow: "escrow.t", rpc: "http://127.0.0.1:3030" };

it("renders one row per payout with its label", () => {
  render(<StatusView model={buildStatus(views(), overlay, FIRMS)} routerOnline {...base} />);
  expect(screen.getAllByRole("row")).toHaveLength(6); // header + 5
  expect(screen.getByText("Delivered after reroute by MX-1")).toBeTruthy();
  expect(screen.getByText("Refunded: account closed (no penalty)")).toBeTruthy();
});

it("says when the router is offline", () => {
  render(<StatusView model={buildStatus(views(), null, FIRMS)} routerOnline={false} {...base} />);
  expect(screen.getByText("Router offline: showing on-chain data only")).toBeTruthy();
});

it("says when the contract is paused", () => {
  const m = buildStatus({ ...views(), config: { ...config, paused: true } }, null, FIRMS);
  render(<StatusView model={m} routerOnline {...base} />);
  expect(
    screen.getByText("Contract paused: no new assignments; settlement and refunds still work"),
  ).toBeTruthy();
});

it("offers the receipt and the verify command", () => {
  render(
    <StatusView
      model={buildStatus(views(), overlay, FIRMS)}
      routerOnline
      receiptUrl="/router/batches/d-1/receipt"
      {...base}
    />,
  );
  expect(screen.getByText("Download receipt")).toBeTruthy();
  expect(
    screen.getByText(
      "Verify it yourself: pnpm verify-receipt <file> --chain --rpc http://127.0.0.1:3030 --escrow escrow.t",
    ),
  ).toBeTruthy();
});

it("never shows a full CLABE", () => {
  const { container } = render(
    <StatusView model={buildStatus(views(), overlay, FIRMS)} routerOnline {...base} />,
  );
  expect(container.textContent ?? "").not.toMatch(/\d{18}/);
});

it("shows a clear message for a batch that does not exist", () => {
  render(
    <StatusView
      model={buildStatus(views([], null), null, FIRMS)}
      routerOnline={false}
      {...base}
      batchId="99"
    />,
  );
  expect(screen.getByText("No batch 99 on escrow.t")).toBeTruthy();
});
