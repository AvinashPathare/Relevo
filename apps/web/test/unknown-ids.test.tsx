import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaoVote } from "../components/DaoVote.tsx";
import { LiveStatus } from "../components/LiveStatus.tsx";
import type { WebConfig } from "../lib/config.ts";
import { config } from "./fixtures.ts";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Counts calls by kind; `dao` answers /dao-proposal, the chain has no batches. */
function installFetch(
  dao: () => Response = () => Response.json({ error: "unknown_draft" }, { status: 404 }),
) {
  const n = { router: 0, dao: 0, rpc: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/config") return Response.json(cfg);
      if (url.endsWith("/dao-proposal")) {
        n.dao++;
        return dao();
      }
      if (url.startsWith("/router/batches/")) {
        n.router++;
        return Response.json({ error: "unknown_draft" }, { status: 404 });
      }
      if (url === "/rpc") {
        n.rpc++;
        const method = JSON.parse(String(init?.body)).params.method_name;
        const v = { get_batch: null, get_config: config, get_batch_payouts: [] }[method as string];
        return Response.json({ result: { result: bytes(v) } });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
  return n;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("unknown ids", () => {
  it("stops polling the router for a draft it does not know", async () => {
    const n = installFetch();
    render(<LiveStatus draftId="nope" pollMs={10} />);
    await screen.findByText("Unknown draft nope: the router has no batch with this id.");
    await sleep(80);
    expect(n.router).toBe(1);
  });

  it("offers no DAO proposal for an unknown draft, and stops asking", async () => {
    const n = installFetch();
    render(<DaoVote draftId="nope" cfg={cfg} funded={false} pollMs={10} />);
    await waitFor(() => expect(n.dao).toBe(1));
    await sleep(80);
    expect(n.dao).toBe(1);
    expect(screen.queryByRole("button", { name: "Create DAO proposal" })).toBeNull();
  });

  it("shows 'No batch abc' for an id that is not a number, without asking the chain", async () => {
    const n = installFetch();
    render(<LiveStatus batchId="abc" pollMs={10} />);
    await screen.findByText("No batch abc on escrow.t");
    expect(n.rpc).toBe(0);
  });

  it("stops polling the chain for a batch id that does not exist", async () => {
    const n = installFetch();
    render(<LiveStatus batchId="99" pollMs={10} />);
    await screen.findByText("No batch 99 on escrow.t");
    const seen = n.rpc;
    await sleep(80);
    expect(n.rpc).toBe(seen);
  });
});

describe("DaoVote: approved but never funded", () => {
  it("says so once the escrow has not recorded the batch in time", async () => {
    installFetch(() =>
      Response.json({
        id: 4,
        status: "Approved",
        kind: {},
        proposer: "council.t",
        votes: {},
        council: ["council.t"],
      }),
    );
    render(<DaoVote draftId="d-1" cfg={cfg} funded={false} pollMs={10} stallMs={40} />);
    await screen.findByText("Approved: waiting for the escrow to record the batch");
    expect(
      await screen.findByText(
        "Proposal #4 was approved, but the escrow has not recorded the batch. The escrow may have refused the funding (for example, while paused); if so, the USDC went back to the DAO.",
      ),
    ).toBeTruthy();
  });
});
