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
