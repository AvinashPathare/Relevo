import { LABEL } from "@elivo/shared/label";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Banner } from "../components/Banner.tsx";

afterEach(cleanup);

it("shows the testnet label verbatim", () => {
  render(<Banner />);
  expect(screen.getByText(LABEL)).toBeTruthy();
});
