import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ValidationView } from "../components/ValidationView.tsx";

afterEach(cleanup);

const cfg = {
  network: "sandbox",
  escrow: "e",
  rate: "18.50",
  cutoff_in_s: 40,
  deadline_in_s: 300,
  grace_ms: 5000,
  fee_buffer_bps: 25,
};

it("lists row errors and offers no way forward", () => {
  render(
    <ValidationView
      result={{ ok: false, errors: [{ row: 5, reason: "clabe_check_digit" }], rows: [] }}
      config={cfg}
    />,
  );
  expect(screen.getByText("Row 5: clabe_check_digit")).toBeTruthy();
  expect(screen.getByText("Fix these rows to continue")).toBeTruthy();
  expect(screen.queryByText("Continue to proposal")).toBeNull();
});

it("shows payees, totals, the fixed rate and the timing on success", () => {
  const amounts = ["2000000000", "2000000000", "1500000000", "2500000000", "1000000000"];
  render(
    <ValidationView
      result={{
        ok: true,
        errors: [],
        draft_id: "abc123",
        total_locked: "9022500000",
        rows: amounts.map((a, i) => ({
          row: i + 2,
          name: `Payee ${i}`,
          clabe_last4: "1234",
          amount_mxn: "37000.00",
          amount_usdc: a,
        })),
      }}
      config={cfg}
    />,
  );
  expect(screen.getByText("Total to lock 9,022.50 USDC")).toBeTruthy();
  expect(screen.getByText("Payouts 9,000.00 USDC")).toBeTruthy();
  expect(screen.getByText("Fee buffer (25 bps) 22.50 USDC")).toBeTruthy();
  expect(screen.getByText("Rate 18.50 MXN/USDC (fixed, simulated)")).toBeTruthy();
  expect(screen.getByText("Cut-off: 40 s after funding (demo) · Final deadline: 300 s")).toBeTruthy();
  expect(screen.getAllByText("****1234")).toHaveLength(5);
  expect(screen.getByText("Continue to proposal").getAttribute("href")).toBe("/batches/abc123");
});
