"use client";
import { useEffect, useState } from "react";
import type { WebConfig } from "../lib/config.ts";
import { type DaoProposal, fetchDaoProposal } from "../lib/dao.ts";
import { demoSigner, type Signer, walletSigner } from "../lib/signer.ts";
import { ProposeView } from "./ProposeView.tsx";

/** Loads the signer (wallet or demo) and polls the DAO proposal until the batch is funded. */
export function DaoVote({ draftId, cfg, funded }: { draftId: string; cfg: WebConfig; funded: boolean }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [wallets, setWallets] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [proposal, setProposal] = useState<DaoProposal | null>(null);
  const [council, setCouncil] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
        if (!stop) {
          setProposal(r.proposal);
          setCouncil(r.council);
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      // Once funded, one read is enough (it names the approved proposal); before that, keep polling.
      if (!stop && !funded) timer = setTimeout(poll, cfg.network === "testnet" ? 5_000 : 2_000);
    };
    poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [draftId, funded, cfg.network, tick]);

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
        onDone={() => setTick((t) => t + 1)}
      />
    </>
  );
}
