/**
 * Pay-in quote through the NEAR Intents 1Click API (spec F14): how much of another asset would deliver
 * the batch's USDC on NEAR. Dry quotes only — nothing is sent, and no user data goes in the request.
 * 1Click is mainnet, so this is a price illustration; the demo itself locks mock USDC on testnet.
 */
export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** Origin assets offered in the UI, with a placeholder refund address valid on each chain. */
export const PAYIN_ASSETS: Record<string, { symbol: string; chain: string; refundTo: string }> = {
  "nep141:eth.omft.near": {
    symbol: "ETH",
    chain: "Ethereum",
    refundTo: "0x0000000000000000000000000000000000000001",
  },
  "nep141:btc.omft.near": { symbol: "BTC", chain: "Bitcoin", refundTo: "1BitcoinEaterAddressDontSendf59kuE" },
  "nep141:sol.omft.near": {
    symbol: "SOL",
    chain: "Solana",
    refundTo: "So11111111111111111111111111111111111111112",
  },
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": {
    symbol: "USDC",
    chain: "Base",
    refundTo: "0x0000000000000000000000000000000000000001",
  },
};

export type PayinQuote =
  | {
      ok: true;
      asset: string;
      symbol: string;
      chain: string;
      amountIn: string;
      amountInUsd: string;
      amountOut: string;
      timeEstimateS: number;
      appFeeBps: number;
    }
  | { ok: false; reason: string };

export interface PayinQuoter {
  tokens(): Promise<unknown[]>;
  quote(assetId: string, amountUnits: string): Promise<PayinQuote>;
}

class Timeout extends Error {}

export function createPayinQuoter(
  opts: { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number; now?: () => number } = {},
): PayinQuoter {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://1click.chaindefuser.com";
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const now = opts.now ?? Date.now;
  let cache: { at: number; tokens: unknown[] } | null = null;

  const withTimeout = <T>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Timeout()), timeoutMs);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  };

  return {
    async tokens() {
      if (cache && now() - cache.at < 10 * 60_000) return cache.tokens;
      const r = await withTimeout(f(`${base}/v0/tokens`));
      const tokens = (await r.json()) as unknown[];
      cache = { at: now(), tokens };
      return tokens;
    },

    async quote(assetId, amountUnits) {
      const meta = PAYIN_ASSETS[assetId];
      if (!meta) return { ok: false, reason: "unknown_asset" };
      try {
        const r = await withTimeout(
          f(`${base}/v0/quote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dry: true,
              swapType: "EXACT_OUTPUT",
              slippageTolerance: 100,
              originAsset: assetId,
              depositType: "ORIGIN_CHAIN",
              destinationAsset: USDC_NEAR,
              amount: amountUnits,
              refundTo: meta.refundTo,
              refundType: "ORIGIN_CHAIN",
              recipient: "example.near",
              recipientType: "DESTINATION_CHAIN",
              deadline: new Date(now() + 3_600_000).toISOString(),
            }),
          }),
        );
        if (!r.ok) return { ok: false, reason: `http_${r.status}` };
        const j = (await withTimeout(r.json()).catch((e) => {
          if (e instanceof Timeout) throw e;
          return null;
        })) as {
          quote?: {
            amountInFormatted?: string;
            amountInUsd?: string;
            amountOutFormatted?: string;
            timeEstimate?: number;
          };
          quoteRequest?: { appFees?: Array<{ fee?: number }> };
        } | null;
        const q = j?.quote;
        if (!q?.amountInFormatted || !q.amountOutFormatted) return { ok: false, reason: "bad_response" };
        return {
          ok: true,
          asset: assetId,
          symbol: meta.symbol,
          chain: meta.chain,
          amountIn: q.amountInFormatted,
          amountInUsd: q.amountInUsd ?? "",
          amountOut: q.amountOutFormatted,
          timeEstimateS: Number(q.timeEstimate ?? 0),
          appFeeBps: (j?.quoteRequest?.appFees ?? []).reduce((s, x) => s + Number(x.fee ?? 0), 0),
        };
      } catch (e) {
        return { ok: false, reason: e instanceof Timeout ? "timeout" : "network_error" };
      }
    },
  };
}
