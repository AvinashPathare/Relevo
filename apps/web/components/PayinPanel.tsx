"use client";
import { formatUsdc } from "@elivo/shared/money";
import { useEffect, useState } from "react";

export const PAYIN_LABEL =
  "Mainnet price quote from NEAR Intents 1Click, for illustration. Nothing is sent; the demo locks mock USDC on testnet.";

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

/** At least 1: two decimals with grouping; below 1: three significant digits. */
function fmtAmount(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n >= 1
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

export function PayinResult({ quote, totalLockedUnits }: { quote: PayinQuote; totalLockedUnits: string }) {
  if (!quote.ok) return <p className="muted">{`Pay-in quote unavailable: ${quote.reason}`}</p>;
  const usd = quote.amountInUsd ? ` (≈ $${fmtAmount(quote.amountInUsd)})` : "";
  const line = `≈ ${fmtAmount(quote.amountIn)} ${quote.symbol} on ${quote.chain}${usd} to deliver ${formatUsdc(
    BigInt(totalLockedUnits),
  )} USDC on NEAR · ~${quote.timeEstimateS} s · 1Click app fee ${quote.appFeeBps} bps`;
  return (
    <>
      <p>{line}</p>
      <p className="muted">{PAYIN_LABEL}</p>
    </>
  );
}

export function PayinPanel({ totalLockedUnits }: { totalLockedUnits: string }) {
  const [assets, setAssets] = useState<Array<{ id: string; symbol: string; chain: string }>>([]);
  const [asset, setAsset] = useState("nep141:eth.omft.near");
  const [quote, setQuote] = useState<PayinQuote | null>(null);

  useEffect(() => {
    fetch("/router/quote/assets")
      .then((r) => r.json())
      .then(setAssets)
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    let live = true;
    setQuote(null);
    fetch(`/router/quote/payin?asset=${encodeURIComponent(asset)}&amount=${totalLockedUnits}`)
      .then((r) => r.json() as Promise<PayinQuote>)
      .catch((): PayinQuote => ({ ok: false, reason: "router_unreachable" }))
      .then((q) => {
        if (live) setQuote(q);
      });
    return () => {
      live = false;
    };
  }, [asset, totalLockedUnits]);

  const options = assets.length ? assets : [{ id: asset, symbol: "ETH", chain: "Ethereum" }];
  return (
    <div className="card">
      <h3>Pay in from another chain</h3>
      <label>
        Asset{" "}
        <select value={asset} onChange={(e) => setAsset(e.target.value)}>
          {options.map((a) => (
            <option key={a.id} value={a.id}>{`${a.symbol} on ${a.chain}`}</option>
          ))}
        </select>
      </label>
      {quote ? (
        <PayinResult quote={quote} totalLockedUnits={totalLockedUnits} />
      ) : (
        <p className="muted">Fetching quote…</p>
      )}
    </div>
  );
}
