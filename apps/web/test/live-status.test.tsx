import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaoVote } from "../components/DaoVote.tsx";
import { LiveStatus } from "../components/LiveStatus.tsx";
import type { WebConfig } from "../lib/config.ts";
import { batch, config, overlay, terminalPayouts } from "./fixtures.ts";

const cfg: WebConfig = {
  network: "sandbox",
  escrow: "escrow.t",
  dao: "dao.t",
  usdc: "usdc.t",
  council: "council.t",
  router: "router.t",
  firms: { mx1: "mx1.t", mx2: "mx2.t", mx3: "mx3.t" },
  signer: "demo",
  routerAvailable: true,
  explorer: null,
  rpcUrl: "http://127.0.0.1:3030",
};
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

/** routerUp(n) decides, per router call number n, whether the router answers. */
function installFetch(
  routerUp: (n: number) => boolean,
  daoProposal: (n: number) => Response = () => new Response("{}", { status: 404 }),
) {
  let routerCalls = 0;
  let daoCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/config") return Response.json(cfg);
      if (url.endsWith("/dao-proposal")) return daoProposal(daoCalls++);
      if (url.startsWith("/router/batches/")) {
        if (!routerUp(routerCalls++)) throw new TypeError("fetch failed");
        return Response.json(overlay);
      }
      if (url === "/rpc") {
        const method = JSON.parse(String(init?.body)).params.method_name;
        const v = {
          get_batch: { ...batch, receipt_hash: null },
          get_config: config,
          get_batch_payouts: terminalPayouts,
        }[method as string];
        return Response.json({ result: { result: bytes(v) } });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LiveStatus on a draft page", () => {
  it("keeps showing on-chain state after the router goes away", async () => {
    installFetch((n) => n === 0);
    render(<LiveStatus draftId="d-1" pollMs={20} />);
    await waitFor(() => expect(screen.getByText("Router offline: showing on-chain data only")).toBeTruthy());
    expect(screen.getByText("Delivered after reroute by MX-1")).toBeTruthy();
  });

  it("after a reload with the router down, reads the chain for the batch seen earlier", async () => {
    installFetch((n) => n === 0);
    const first = render(<LiveStatus draftId="d-1" pollMs={20} />);
    await waitFor(() => expect(screen.getByText("Delivered after reroute by MX-1")).toBeTruthy());
    first.unmount();
    installFetch(() => false);
    render(<LiveStatus draftId="d-1" pollMs={20} />);
    await waitFor(() => expect(screen.getByText("Router offline: showing on-chain data only")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Refunded: account closed (no penalty)")).toBeTruthy());
  });

  it("says the router is offline even before any batch is known", async () => {
    installFetch(() => false);
    render(<LiveStatus draftId="d-9" pollMs={20} />);
    await waitFor(() => expect(screen.getByText("Router offline: showing on-chain data only")).toBeTruthy());
  });
});

describe("DaoVote", () => {
  it("recovers after a transient router error", async () => {
    installFetch(
      () => true,
      (n) => (n === 0 ? new Response("boom", { status: 500 }) : new Response("{}", { status: 404 })),
    );
    render(<DaoVote draftId="d-1" cfg={cfg} funded={false} pollMs={20} />);
    await waitFor(() => expect(screen.getByText(/dao-proposal: HTTP 500/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText(/dao-proposal: HTTP 500/)).toBeNull());
    expect(screen.getByText("No DAO proposal yet")).toBeTruthy();
  });
});
