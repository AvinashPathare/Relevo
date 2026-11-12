"use client";
import { scoreboardFromFirms } from "@elivo/shared/scoreboard";
import type { ConfigView, FirmView } from "@elivo/shared/views";
import { useEffect, useState } from "react";
import { Scoreboard, type ScoreRow } from "../../components/Scoreboard.tsx";
import { Eyebrow } from "../../components/ui.tsx";
import { fetchConfig, firmNames } from "../../lib/config.ts";
import { viewCall } from "../../lib/rpc.ts";

export default function FirmsPage() {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [multiple, setMultiple] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const cfg = await fetchConfig();
      const [list, escrowCfg] = await Promise.all([
        viewCall<Array<[string, FirmView]>>(cfg.escrow, "list_firms"),
        viewCall<ConfigView>(cfg.escrow, "get_config"),
      ]);
      setMultiple(escrowCfg.exposure_multiple);
      const scores = scoreboardFromFirms(list);
      const names = firmNames(cfg);
      setRows(
        list
          .map(([id, f]) => ({
            name: names[id] ?? id,
            bond: f.bond,
            approved: f.approved,
            score: scores[id],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })().catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="stack">
      <div>
        <Eyebrow>Payout firms · on-chain record</Eyebrow>
        <h1 className="page-title">Payout firms</h1>
        <p className="lede">
          Simulated firms with real testnet bonds. A late firm is rerouted and pays 1 bp per period late to
          the DAO, capped at 2%.
        </p>
      </div>
      {error && <p className="bad">Could not load: {error}</p>}
      {rows && multiple !== null ? (
        <Scoreboard rows={rows} exposureMultiple={multiple} />
      ) : (
        !error && <p className="muted">Loading…</p>
      )}
    </div>
  );
}
