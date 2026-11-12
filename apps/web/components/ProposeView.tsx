"use client";
import { useState } from "react";
import type { DaoProposal } from "../lib/dao.ts";
import type { Signer } from "../lib/signer.ts";
import { Button, Chip, Eyebrow, Sticker } from "./ui.tsx";

export const DEMO_LABEL = "Demo signer: local sandbox keys, not a wallet";

export interface ProposeViewProps {
  draftId: string;
  proposal: DaoProposal | null;
  council: string[];
  signer: Signer;
  funded: boolean;
  /** Approved for a while, and the escrow still hasn't recorded the batch. */
  stalled?: boolean;
  /** Called after a signing step returns (demo signer) so the page can refresh. */
  onDone?: () => void;
}

export function ProposeView({
  draftId,
  proposal,
  council,
  signer,
  funded,
  stalled,
  onDone,
}: ProposeViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await f();
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (funded && proposal)
    return (
      <div className="row">
        <Chip tone="mint">{`DAO proposal #${proposal.id} approved; the batch is funded.`}</Chip>
      </div>
    );
  if (funded)
    return (
      <div className="row">
        <Chip tone="mint">The batch is funded.</Chip>
      </div>
    );
  const isCouncil = !!signer.accountId && council.includes(signer.accountId);
  return (
    <Sticker tone="lavender">
      <Eyebrow>03 · DAO vote</Eyebrow>
      <h2>One vote funds the batch</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        {signer.mode === "demo" ? (
          <span className="tag">{DEMO_LABEL}</span>
        ) : (
          <span className="muted small">
            {signer.accountId ? `Signed in as ${signer.accountId}` : "Not signed in"}
          </span>
        )}
      </div>
      {!proposal && (
        <div className="stack">
          <p>No DAO proposal yet</p>
          <div>
            <Button disabled={busy} onClick={run(() => signer.propose(draftId))}>
              Create DAO proposal
            </Button>
          </div>
        </div>
      )}
      {proposal && proposal.status === "InProgress" && (
        <div className="stack">
          <p>{`Proposal #${proposal.id}: waiting for the council's vote`}</p>
          <div>
            <Button
              variant="dark"
              disabled={busy || !isCouncil}
              onClick={run(() => signer.approve(proposal))}
            >
              Approve as council
            </Button>
          </div>
          {!isCouncil && <p className="muted small">Only council members can approve</p>}
        </div>
      )}
      {proposal && proposal.status === "Approved" && (
        <div className="stack">
          <p>Approved: waiting for the escrow to record the batch</p>
          {stalled && (
            <p className="bad">{`Proposal #${proposal.id} was approved, but the escrow has not recorded the batch. The escrow may have refused the funding (for example, while paused); if so, the USDC went back to the DAO.`}</p>
          )}
        </div>
      )}
      {proposal && !["InProgress", "Approved"].includes(proposal.status) && (
        <p className="bad">{`Proposal #${proposal.id} is ${proposal.status}. Nothing was funded.`}</p>
      )}
      {error && <p className="bad">{error}</p>}
    </Sticker>
  );
}
