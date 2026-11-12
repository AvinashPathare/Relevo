"use client";
import { useEffect, useRef, useState } from "react";
import type { WebConfig } from "../lib/config.ts";
import { type DaoProposal, fetchDaoProposal } from "../lib/dao.ts";
import { demoSigner, type Signer, walletSigner } from "../lib/signer.ts";
import { ProposeView } from "./ProposeView.tsx";

/** Loads the signer (wallet or demo) and polls the DAO proposal until the batch is funded. */
export function DaoVote({
  draftId,
  cfg,
  funded,
  pollMs,
  stallMs,
}: {
  draftId: string;
  cfg: WebConfig;
  funded: boolean;
  /** Poll interval override (tests). */
  pollMs?: number;
  /** How long "Approved" may go without the escrow recording the batch before we say so. */
  stallMs?: number;
}) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [wallets, setWallets] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [proposal, setProposal] = useState<DaoProposal | null>(null);
  const [council, setCouncil] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unknownDraft, setUnknownDraft] = useState(false);
  const [stalled, setStalled] = useState(false);
  /** When this page first saw the proposal Approved (the escrow should record the batch soon after). */
  const approvedAt = useRef<number | null>(null);

  useEffect(() => {
    if (cfg.signer === "demo") {
      setSigner(demoSigner(cfg.council));
      return;
    }
    import("../lib/wallet.ts")
      .then(async ({ walletPort, WALLETS }) => {
        setWallets(WALLETS);
        setSigner(walletSigner(await walletPort(), cfg));
      })
      .catch((e) => setError(`wallet: ${(e as Error).message}`));
  }, [cfg]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetchDaoProposal(draftId);
        if (stop) return;
        if (r.unknownDraft) {
          setUnknownDraft(true); // LiveStatus says so; there is nothing to vote on
          return;
        }
        setProposal(r.proposal);
        setCouncil(r.council);
        setError(null);
        if (r.proposal?.status === "Approved") {
          approvedAt.current ??= Date.now();
          const limit = stallMs ?? (cfg.network === "testnet" ? 180_000 : 60_000);
          setStalled(Date.now() - approvedAt.current >= limit);
        } else {
          approvedAt.current = null;
          setStalled(false);
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      // Once funded, one read is enough (it names the approved proposal); before that, keep polling.
      if (!stop && !funded) timer = setTimeout(poll, pollMs ?? (cfg.network === "testnet" ? 5_000 : 2_000));
    };
    poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, funded, cfg.network, tick, pollMs, stallMs]);

  if (unknownDraft) return null;
  if (error) return <p className="bad">{error}</p>;
  if (!signer) return <p className="muted">Loading signer…</p>;
  return (
    <>
      {signer.mode === "wallet" && !signer.accountId && !funded && (
        <p>
          {wallets.map((w) => (
            <button key={w.id} type="button" className="secondary" onClick={() => signer.signIn(w.id)}>
              {`Connect ${w.name}`}
            </button>
          ))}
        </p>
      )}
      <ProposeView
        draftId={draftId}
        proposal={proposal}
        council={council}
        signer={signer}
        funded={funded}
        stalled={stalled}
        onDone={() => setTick((t) => t + 1)}
      />
    </>
  );
}
