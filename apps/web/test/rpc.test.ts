import { describe, expect, it } from "vitest";
import { viewCall } from "../lib/rpc.ts";

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

function fakeFetch(response: unknown, seen: { url?: string; body?: unknown }) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(response), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("viewCall", () => {
  it("posts a call_function query to /rpc with base64 JSON args", async () => {
    const seen: { url?: string; body?: unknown } = {};
    await viewCall(
      "e.test",
      "get_batch",
      { batch_id: "5" },
      {
        fetch: fakeFetch({ result: { result: bytes("null") } }, seen),
      },
    );
    expect(seen.url).toBe("/rpc");
    expect(seen.body).toMatchObject({
      jsonrpc: "2.0",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "e.test",
        method_name: "get_batch",
        args_base64: btoa(JSON.stringify({ batch_id: "5" })),
      },
    });
  });

  it("decodes the result bytes as JSON", async () => {
    const v = await viewCall<{ id: string }>(
      "e.test",
      "get_batch",
      { batch_id: "5" },
      {
        fetch: fakeFetch({ result: { result: bytes('{"id":"5"}') } }, {}),
      },
    );
    expect(v).toEqual({ id: "5" });
  });

  it("rejects on an RPC error", async () => {
    await expect(
      viewCall("e.test", "get_batch", {}, { fetch: fakeFetch({ error: { data: "boom" } }, {}) }),
    ).rejects.toThrow(/view get_batch.*boom/);
  });

  it("rejects on a contract error", async () => {
    await expect(
      viewCall("e.test", "get_batch", {}, { fetch: fakeFetch({ result: { error: "wasm panic" } }, {}) }),
    ).rejects.toThrow(/wasm panic/);
  });
});
