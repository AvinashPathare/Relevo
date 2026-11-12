import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewBatchPage from "../app/new/page.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installFetch(sample: () => Response | Promise<Response>) {
  const validate = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/router/config") return Response.json({ rate: "18.50", fee_buffer_bps: 25 });
      if (url.startsWith("/router/samples/")) return sample();
      if (url === "/router/batches/validate") return validate();
      throw new Error(`unexpected ${url}`);
    }),
  );
  return validate;
}

describe("New batch: sample buttons", () => {
  it("says the sample could not be loaded when the router answers with an error", async () => {
    const validate = installFetch(() => new Response("bad gateway", { status: 502 }));
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Use sample" }));
    expect(await screen.findByText("Could not load the sample: router HTTP 502")).toBeTruthy();
    expect(validate).not.toHaveBeenCalled();
  });

  it("says the router is not running when the sample request fails outright", async () => {
    installFetch(() => {
      throw new TypeError("fetch failed");
    });
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Use sample with a typo" }));
    expect(
      await screen.findByText(
        "Could not load the sample: the router is not running. Start the app with pnpm dev.",
      ),
    ).toBeTruthy();
  });
});
