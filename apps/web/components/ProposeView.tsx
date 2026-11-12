"use client";
import { useState } from "react";
import type { DaoProposal } from "../lib/dao.ts";
import type { Signer } from "../lib/signer.ts";

export const DEMO_LABEL = "Demo signer: local sandbox keys, not a wallet";

export interface ProposeViewProps {
  draftId: string;
  proposal: DaoProposal | null;
  council: string[];
  signer: Signer;
  funded: boolean;
  /** Called after a signing step returns (demo signer) so the page can refresh. */
  onDone?: () => void;
}

export function ProposeView({ draftId, proposal, council, signer, funded, onDone }: ProposeViewProps) {
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
    return <p className="ok">{`DAO proposal #${proposal.id} approved; the batch is funded.`}</p>;
  if (funded) return <p className="ok">The batch is funded.</p>;
  const isCouncil = !!signer.accountId && council.includes(signer.accountId);
  return (
    <div className="card">
      <h2>DAO vote</h2>
      {signer.mode === "demo" ? (
        <p className="tag">{DEMO_LABEL}</p>
      ) : (
        <p className="muted">{signer.accountId ? `Signed in as ${signer.accountId}` : "Not signed in"}</p>
      )}
      {!proposal && (
        <>
          <p>No DAO proposal yet</p>
          <button type="button" disabled={busy} onClick={run(() => signer.propose(draftId))}>
            Create DAO proposal
          </button>
        </>
      )}
      {proposal && proposal.status === "InProgress" && (
        <>
          <p>{`Proposal #${proposal.id}: waiting for the council's vote`}</p>
          <button type="button" disabled={busy || !isCouncil} onClick={run(() => signer.approve(proposal))}>
            Approve as council
          </button>
          {!isCouncil && <p className="muted">Only council members can approve</p>}
        </>
      )}
      {proposal && proposal.status === "Approved" && (
        <p>Approved: waiting for the escrow to record the batch</p>
      )}
      {proposal && !["InProgress", "Approved"].includes(proposal.status) && (
        <p className="bad">{`Proposal #${proposal.id} is ${proposal.status}. Nothing was funded.`}</p>
      )}
      {error && <p className="bad">{error}</p>}
    </div>
  );
}
