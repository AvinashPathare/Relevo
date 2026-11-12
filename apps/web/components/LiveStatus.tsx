"use client";
import { useEffect, useRef, useState } from "react";
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
  /** Poll interval override (tests). */
  pollMs?: number;
}

const idKey = (draftId: string) => `elivo:onchain:${draftId}`;

/** The on-chain batch id a draft was last seen funded as, so a reload can read the chain without the router. */
function rememberedId(draftId: string | undefined): string | undefined {
  if (!draftId) return undefined;
  try {
    return sessionStorage.getItem(idKey(draftId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(draftId: string, id: string) {
  try {
    sessionStorage.setItem(idKey(draftId), id);
  } catch {
    // storage unavailable: the router is then the only source of the id
  }
}

/** Polls the chain (and the router, for a draft) and renders StatusView. Stops once the receipt is anchored. */
export function LiveStatus({ batchId, draftId, onOverlay, pollMs }: LiveStatusProps) {
  const [cfg, setCfg] = useState<WebConfig | null>(null);
  const [model, setModel] = useState<StatusModel | null>(null);
  const [routerOnline, setRouterOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unknownDraft, setUnknownDraft] = useState(false);
  /** Last overlay and on-chain id seen, kept when the router goes away so the chain view continues. */
  const lastOverlay = useRef<RouterBatchStatus | null>(null);
  const knownId = useRef<string | undefined>(undefined);

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
      const every = pollMs ?? (c.network === "testnet" ? 5_000 : 2_000);
      knownId.current ??= rememberedId(draftId);
      const poll = async () => {
        let overlay: RouterBatchStatus | null = null;
        let online = !!batchId;
        let onchainId = batchId ?? knownId.current;
        if (draftId) {
          try {
            const r = await fetch(`/router/batches/${encodeURIComponent(draftId)}`);
            online = r.ok || r.status === 404;
            if (r.status === 404) setUnknownDraft(true);
            if (r.ok) {
              overlay = (await r.json()) as RouterBatchStatus;
              lastOverlay.current = overlay;
              if (overlay.onchain?.id !== undefined) {
                onchainId = overlay.onchain.id;
                knownId.current = onchainId;
                remember(draftId, onchainId);
              }
            }
          } catch {
            online = false;
          }
          // Router unreachable: keep reading the chain, with the names last seen (if any).
          if (!online) overlay = lastOverlay.current;
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
  }, [batchId, draftId, onOverlay, pollMs]);

  if (error && !model) return <p className="bad">Could not load: {error}</p>;
  if (unknownDraft) return <p>Unknown draft {draftId}: the router has no batch with this id.</p>;
  if (!cfg) return <p className="muted">Loading…</p>;
  if (!model) {
    if (draftId && !routerOnline)
      return (
        <>
          <p className="tag">Router offline: showing on-chain data only</p>
          <p className="muted">
            No on-chain batch is known for this draft yet. Funded batches stay visible at{" "}
            <code>/chain/&lt;batch id&gt;</code>.
          </p>
        </>
      );
    return draftId ? null : <p className="muted">Loading…</p>;
  }
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
