"use client";
import { scoreboardFromFirms } from "@elivo/shared/scoreboard";
import type { FirmView } from "@elivo/shared/views";
import { useEffect, useState } from "react";
import { Scoreboard, type ScoreRow } from "../../components/Scoreboard.tsx";
import { fetchConfig, firmNames } from "../../lib/config.ts";
import { viewCall } from "../../lib/rpc.ts";

export default function FirmsPage() {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const cfg = await fetchConfig();
      const list = await viewCall<Array<[string, FirmView]>>(cfg.escrow, "list_firms");
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
    <>
      <h1>Payout firms</h1>
      <p className="muted">
        Simulated firms with real testnet bonds. A late firm is rerouted and pays 1 bp per period late to the
        DAO, capped at 2%.
      </p>
      {error && <p className="bad">Could not load: {error}</p>}
      {rows ? <Scoreboard rows={rows} /> : !error && <p className="muted">Loading…</p>}
    </>
  );
}
