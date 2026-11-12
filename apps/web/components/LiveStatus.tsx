"use client";
import { useEffect, useState } from "react";
import { fetchConfig, firmNames, type WebConfig } from "../lib/config.ts";
import { buildStatus, loadChainViews, type RouterBatchStatus, type StatusModel } from "../lib/status.ts";
import { StatusView } from "./StatusView.tsx";

export interface LiveStatusProps {
  /** On-chain batch id: read-only, straight from the contract. */
  batchId?: string;
  /** Router draft id: adds payee names, tx links and the receipt. */
  draftId?: string;
  /** Called with the router's view on every poll (the propose screen uses it). */
  onOverlay?: (o: RouterBatchStatus | null, routerOnline: boolean) => void;
}

/** Polls the chain (and the router, for a draft) and renders StatusView. Stops once the receipt is anchored. */
export function LiveStatus({ batchId, draftId, onOverlay }: LiveStatusProps) {
  const [cfg, setCfg] = useState<WebConfig | null>(null);
  const [model, setModel] = useState<StatusModel | null>(null);
  const [routerOnline, setRouterOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unknownDraft, setUnknownDraft] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      let c: WebConfig;
      try {
        c = await fetchConfig();
        setCfg(c);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      const every = c.network === "testnet" ? 5_000 : 2_000;
      const poll = async () => {
        let overlay: RouterBatchStatus | null = null;
        let online = !!batchId;
        let onchainId = batchId;
        if (draftId) {
          try {
            const r = await fetch(`/router/batches/${encodeURIComponent(draftId)}`);
            online = r.ok || r.status === 404;
            if (r.status === 404) setUnknownDraft(true);
            if (r.ok) {
              overlay = (await r.json()) as RouterBatchStatus;
              onchainId = overlay.onchain?.id;
            }
          } catch {
            online = false;
          }
          setRouterOnline(online);
          onOverlay?.(overlay, online);
        }
        let done = false;
        if (onchainId !== undefined) {
          try {
            const views = await loadChainViews(c.escrow, onchainId);
            const m = buildStatus(views, overlay, firmNames(c), BigInt(Date.now()) * 1_000_000n);
            setModel(m);
            setError(null);
            done = m.terminal && m.anchored;
          } catch (e) {
            setError((e as Error).message);
          }
        }
        if (!stop && !done) timer = setTimeout(poll, every);
      };
      await poll();
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [batchId, draftId, onOverlay]);

  if (error && !model) return <p className="bad">Could not load: {error}</p>;
  if (unknownDraft) return <p>Unknown draft {draftId}: the router has no batch with this id.</p>;
  if (!cfg) return <p className="muted">Loading…</p>;
  if (!model) return draftId ? null : <p className="muted">Loading…</p>;
  return (
    <StatusView
      model={model}
      routerOnline={routerOnline}
      network={cfg.network}
      escrow={cfg.escrow}
      rpc={cfg.rpcUrl}
      batchId={batchId ?? model.batchId ?? undefined}
      explorer={cfg.explorer}
      receiptUrl={draftId ? `/router/batches/${encodeURIComponent(draftId)}/receipt` : undefined}
    />
  );
}
