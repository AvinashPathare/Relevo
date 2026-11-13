import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("next.config rewrites", () => {
  it("forward only the router paths the UI uses", async () => {
    process.env.ROUTER_URL = "http://127.0.0.1:7400";
    process.env.DEMO_SIGNER_URL = "http://127.0.0.1:7430";
    process.env.NEAR_RPC_URL = "http://127.0.0.1:3030";
    const { default: config } = await import("../next.config.ts");
    const rules = (await (config.rewrites as () => Promise<Array<{ source: string }>>)()).map(
      (r) => r.source,
    );
    expect(rules).not.toContain("/router/:path*");
    expect(rules).not.toContain("/rpc");
    for (const internal of ["/router/sim", "/router/proofs", "/router/exclusions", "/router/orders"])
      expect(rules.some((r) => r.startsWith(internal))).toBe(false);
    expect(rules).toEqual(
      expect.arrayContaining([
        "/router/config",
        "/router/samples/:name",
        "/router/quote/:path*",
        "/router/batches/:path*",
      ]),
    );
  });
});

describe("/rpc handler", () => {
  const req = (body: object) => new Request("http://x/rpc", { method: "POST", body: JSON.stringify(body) });
  const TESTNET = JSON.parse(readFileSync("deployments/testnet.json", "utf8"));
  const view = (account_id: string) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id,
      method_name: "get_config",
      args_base64: "e30=",
    },
  });

  it("reads only this app's escrow, so a public site is not a free RPC proxy", async () => {
    delete process.env.ELIVO_DEPLOYMENT_JSON;
    process.env.NEAR_RPC_URL = "http://127.0.0.1:3030";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { POST } = await import("../app/rpc/route.ts");
    expect((await POST(req(view("usdc.tether-token.near")))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it("with nothing configured, forwards to the public testnet RPC", async () => {
    delete process.env.ELIVO_DEPLOYMENT_JSON;
    delete process.env.NEAR_RPC_URL;
    const f = vi.fn(async () => Response.json({ result: { result: [] } }));
    vi.stubGlobal("fetch", f);
    const { POST } = await import("../app/rpc/route.ts");
    expect((await POST(req(view(TESTNET.escrow)))).status).toBe(200);
    expect((f.mock.calls[0] as unknown[])[0]).toBe(TESTNET.rpcUrl);
  });

  it("forwards view calls to the NEAR RPC", async () => {
    process.env.NEAR_RPC_URL = "http://127.0.0.1:3030";
    const f = vi.fn(async () => Response.json({ result: { result: [] } }));
    vi.stubGlobal("fetch", f);
    const { POST } = await import("../app/rpc/route.ts");
    const r = await POST(req(view(TESTNET.escrow)));
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledOnce();
    expect((f.mock.calls[0] as unknown[])[0]).toBe("http://127.0.0.1:3030");
  });

  it("refuses anything else without contacting the RPC", async () => {
    process.env.NEAR_RPC_URL = "http://127.0.0.1:3030";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { POST } = await import("../app/rpc/route.ts");
    for (const body of [
      { method: "sandbox_patch_state", params: {} },
      { method: "broadcast_tx_commit", params: [] },
      { method: "query", params: { request_type: "view_access_key_list" } },
    ])
      expect((await POST(req(body))).status).toBe(403);
    expect((await POST(new Request("http://x/rpc", { method: "POST", body: "not json" }))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
