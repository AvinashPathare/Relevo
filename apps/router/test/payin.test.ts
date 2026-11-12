import { describe, expect, it } from "vitest";
import { createPayinQuoter, USDC_NEAR } from "../src/payin.ts";

const NOW = Date.parse("2026-11-12T00:00:00Z");
const ETH = "nep141:eth.omft.near";
// Fields from a real dry quote on 12 Nov 2026 (100 USDC; trimmed).
const recorded = {
  quote: {
    amountIn: "49173284692011877",
    amountInFormatted: "0.049173284692011877",
    amountInUsd: "101.218780942884",
    amountOutFormatted: "100.0",
    timeEstimate: 45,
  },
  quoteRequest: { appFees: [{ recipient: "x", fee: 20 }] },
};

function fakeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("1Click pay-in quoter", () => {
  it("sends a dry EXACT_OUTPUT quote for USDC on NEAR with every pinned field", async () => {
    const { f, calls } = fakeFetch(() => Response.json(recorded, { status: 201 }));
    const q = createPayinQuoter({ fetch: f, now: () => NOW });
    await q.quote(ETH, "9022500000");
    expect(calls[0].url).toBe("https://1click.chaindefuser.com/v0/quote");
    expect(calls[0].body).toEqual({
      dry: true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: ETH,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_NEAR,
      amount: "9022500000",
      refundTo: "0x0000000000000000000000000000000000000001",
      refundType: "ORIGIN_CHAIN",
      recipient: "example.near",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-12T01:00:00.000Z",
    });
  });

  it("maps a quote to what the panel shows", async () => {
    const { f } = fakeFetch(() => Response.json(recorded, { status: 201 }));
    expect(await createPayinQuoter({ fetch: f, now: () => NOW }).quote(ETH, "100000000")).toEqual({
      ok: true,
      asset: ETH,
      symbol: "ETH",
      chain: "Ethereum",
      amountIn: "0.049173284692011877",
      amountInUsd: "101.218780942884",
      amountOut: "100.0",
      timeEstimateS: 45,
      appFeeBps: 20,
    });
  });

  it("rejects an unknown asset without calling 1Click", async () => {
    const { f, calls } = fakeFetch(() => Response.json({}));
    expect(await createPayinQuoter({ fetch: f }).quote("nep141:wrap.near", "1")).toEqual({
      ok: false,
      reason: "unknown_asset",
    });
    expect(calls).toHaveLength(0);
  });

  it("times out instead of hanging", async () => {
    const { f } = fakeFetch(() => new Promise<Response>(() => {}));
    const t0 = Date.now();
    expect(await createPayinQuoter({ fetch: f, timeoutMs: 50 }).quote(ETH, "1")).toEqual({
      ok: false,
      reason: "timeout",
    });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("reports HTTP errors and bad bodies", async () => {
    const e500 = fakeFetch(() => new Response("boom", { status: 500 }));
    expect(await createPayinQuoter({ fetch: e500.f }).quote(ETH, "1")).toEqual({
      ok: false,
      reason: "http_500",
    });
    const junk = fakeFetch(() => new Response("<html>", { status: 201 }));
    expect(await createPayinQuoter({ fetch: junk.f }).quote(ETH, "1")).toEqual({
      ok: false,
      reason: "bad_response",
    });
    const empty = fakeFetch(() => Response.json({ nope: 1 }, { status: 201 }));
    expect(await createPayinQuoter({ fetch: empty.f }).quote(ETH, "1")).toEqual({
      ok: false,
      reason: "bad_response",
    });
  });

  it("caches the token list for 10 minutes", async () => {
    let t = NOW;
    const { f, calls } = fakeFetch(() => Response.json([{ assetId: ETH, symbol: "ETH" }]));
    const q = createPayinQuoter({ fetch: f, now: () => t });
    await q.tokens();
    await q.tokens();
    expect(calls).toHaveLength(1);
    t += 11 * 60_000;
    await q.tokens();
    expect(calls).toHaveLength(2);
  });
});
