import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Logo } from "../components/Logo.tsx";

afterEach(cleanup);

it("is the Relevo wordmark, named for screen readers", () => {
  render(<Logo />);
  const svg = screen.getByRole("img", { name: "Relevo" });
  // r, e, l, e, v and the two arcs of the relay ring
  expect(svg.querySelectorAll("path")).toHaveLength(8);
});
