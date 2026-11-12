"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DaoVote } from "../../../components/DaoVote.tsx";
import { LiveStatus } from "../../../components/LiveStatus.tsx";
import { fetchConfig, type WebConfig } from "../../../lib/config.ts";
import type { RouterBatchStatus } from "../../../lib/status.ts";

export default function DraftBatchPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const [cfg, setCfg] = useState<WebConfig | null>(null);
  const [overlay, setOverlay] = useState<RouterBatchStatus | null>(null);
  useEffect(() => {
    fetchConfig().then(setCfg, () => {});
  }, []);
  const onOverlay = useCallback((o: RouterBatchStatus | null) => setOverlay(o), []);
  const funded = !!overlay?.onchain;
  return (
    <>
      <h1>Payout batch</h1>
      {overlay && !funded && (
        <p className="muted">
          {`${overlay.draft.rows.length} payees validated. Batch hash ${overlay.draft.batch_hash.slice(0, 16)}… (salted; names and accounts stay off-chain).`}
        </p>
      )}
      {cfg && cfg.routerAvailable && <DaoVote draftId={draftId} cfg={cfg} funded={funded} />}
      <LiveStatus draftId={draftId} onOverlay={onOverlay} />
    </>
  );
}
