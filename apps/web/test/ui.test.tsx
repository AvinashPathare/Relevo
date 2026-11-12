import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, Chip, Eyebrow, Progress, Steps, Sticker, Ticket, Window } from "../components/ui.tsx";

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

  it("Window shows a path title with a status dot", () => {
    render(
      <Window title="~/batches/abc123" status="live">
        body
      </Window>,
    );
    expect(screen.getByText("~/batches/abc123")).toBeTruthy();
    const win = screen.getByRole("region", { name: "~/batches/abc123" });
    expect(win.dataset.status).toBe("live");
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("Progress reports its value", () => {
    render(<Progress value={3} max={5} label="3 of 5 payouts final" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(screen.getByText("3 of 5 payouts final")).toBeTruthy();
    expect((bar.querySelector(".progress-fill") as HTMLElement).style.width).toBe("60%");
  });
});
