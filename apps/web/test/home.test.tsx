import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Home from "../app/page.tsx";
import { navLinks } from "../lib/deployment.ts";

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

it("on a read-only site, leads to the reference run and its receipt instead of a new batch", () => {
  const saved = process.env.ROUTER_URL;
  delete process.env.ROUTER_URL;
  delete process.env.ELIVO_DEPLOYMENT_JSON;
  try {
    const { getByRole, queryByRole } = render(<Home />);
    expect(getByRole("link", { name: "See the reference run →" }).getAttribute("href")).toBe("/chain/5");
    expect(getByRole("link", { name: "Verify its receipt" }).getAttribute("href")).toBe("/verify");
    expect(queryByRole("link", { name: /Start a batch/ })).toBeNull();
    expect(navLinks(false).map((l) => l.href)).toEqual(["/firms", "/verify"]);
    expect(navLinks(true).map((l) => l.href)).toEqual(["/new", "/firms", "/verify"]);
  } finally {
    if (saved !== undefined) process.env.ROUTER_URL = saved;
  }
});
