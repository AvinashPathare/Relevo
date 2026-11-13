import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Home from "../app/page.tsx";

afterEach(cleanup);

it("presents a testnet prototype with simulated firms, not a guarantee", () => {
  const { container } = render(<Home />);
  const text = container.textContent ?? "";
  expect(text).toMatch(/testnet prototype/i);
  expect(text).toMatch(/simulated/i);
  expect(text).not.toMatch(/guarantee/i);
});

it("says who else the pattern is for, with the DAO as the live example", () => {
  const { container } = render(<Home />);
  const text = container.textContent ?? "";
  expect(text).toContain("Who it's for");
  for (const who of ["Grant and aid programmes", "Payroll and contractor platforms", "Payout providers"])
    expect(text).toContain(who);
  expect(text).toContain("This demo's funder is a DAO");
});
