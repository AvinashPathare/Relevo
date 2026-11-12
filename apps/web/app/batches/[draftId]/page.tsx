"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DaoVote } from "../../../components/DaoVote.tsx";
import { LiveStatus } from "../../../components/LiveStatus.tsx";
import { Eyebrow, Steps } from "../../../components/ui.tsx";
import { fetchConfig, type WebConfig } from "../../../lib/config.ts";
import type { RouterBatchStatus } from "../../../lib/status.ts";

export default function DraftBatchPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const [cfg, setCfg] = useState<WebConfig | null>(null);
  const [overlay, setOverlay] = useState<RouterBatchStatus | null>(null);
  // Sticky: once funded, a router blip must not bring the vote card back.
  const [funded, setFunded] = useState(false);
  useEffect(() => {
    fetchConfig().then(setCfg, () => {});
  }, []);
  const onOverlay = useCallback((o: RouterBatchStatus | null) => {
    if (o) setOverlay(o);
    if (o?.onchain) setFunded(true);
  }, []);
  return (
    <div className="stack">
      <Steps current={funded ? 4 : 3} />
      <div>
        <Eyebrow>{funded ? "04 · Status" : "03 · Vote"}</Eyebrow>
        <h1 className="page-title">Payout batch</h1>
        {overlay && !funded && (
          <p className="muted">
            {`${overlay.draft.rows.length} payees validated. Batch hash ${overlay.draft.batch_hash.slice(0, 16)}… (salted; names and accounts stay off-chain).`}
          </p>
        )}
      </div>
      {cfg?.routerAvailable && <DaoVote draftId={draftId} cfg={cfg} funded={funded} />}
      <LiveStatus draftId={draftId} onOverlay={onOverlay} />
    </div>
  );
}
