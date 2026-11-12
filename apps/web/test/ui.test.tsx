import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, Chip, Eyebrow, Steps, Sticker, Ticket } from "../components/ui.tsx";

afterEach(cleanup);

describe("ui primitives", () => {
  it("Eyebrow renders a mono label", () => {
    render(<Eyebrow>01 · UPLOAD</Eyebrow>);
    expect(screen.getByText("01 · UPLOAD").className).toContain("eyebrow");
  });

  it("Sticker can tilt", () => {
    render(
      <Sticker tilt={-2} tone="lavender">
        hello
      </Sticker>,
    );
    const el = screen.getByText("hello");
    expect(el.className).toContain("sticker");
    expect(el.className).toContain("tone-lavender");
    expect(el.style.getPropertyValue("--tilt")).toBe("-2deg");
  });

  it("Button has variants and renders as a link when given href", () => {
    render(
      <>
        <Button variant="primary">Go</Button>
        <Button variant="secondary" href="/new">
          New
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Go" }).className).toContain("btn-primary");
    const link = screen.getByRole("link", { name: "New" });
    expect(link.getAttribute("href")).toBe("/new");
    expect(link.className).toContain("btn-secondary");
  });

  it("Chip carries a tone", () => {
    render(<Chip tone="mint">Delivered</Chip>);
    expect(screen.getByText("Delivered").className).toContain("chip-mint");
  });

  it("Ticket shows a label and a value", () => {
    render(<Ticket label="Total to lock" value="9,022.50" unit="USDC" tone="peach" />);
    expect(screen.getByText("Total to lock")).toBeTruthy();
    expect(screen.getByText("9,022.50")).toBeTruthy();
    expect(screen.getByText("USDC")).toBeTruthy();
  });

  it("Steps marks done and current steps", () => {
    render(<Steps current={2} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["01Upload", "02Quote", "03Vote", "04Status"]);
    expect(items[0].dataset.state).toBe("done");
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[2].dataset.state).toBe("todo");
  });
});
