import { formatUsdc } from "@elivo/shared/money";
import type { FirmScore } from "@elivo/shared/scoreboard";

export interface ScoreRow {
  name: string;
  bond: string;
  approved: boolean;
  score: FirmScore;
}

function line(r: ScoreRow): string {
  const s = r.score;
  const total = s.onTime + s.late;
  const pct = s.onTimeRate === null ? "no deliveries yet" : `${Math.round(s.onTimeRate * 100)}%`;
  return `${r.name} · on time ${s.onTime}/${total} (${pct}) · penalties ${formatUsdc(BigInt(s.penaltiesPaid))} USDC · volume ${formatUsdc(BigInt(s.volume))} USDC`;
}

export function Scoreboard({ rows }: { rows: ScoreRow[] }) {
  return (
    <>
      <ul>
        {rows.map((r) => (
          <li key={r.score.firm}>
            <div>{line(r)}</div>
            <div className="muted">{`Bond ${formatUsdc(BigInt(r.bond))} USDC · max open exposure ${formatUsdc(BigInt(r.bond) * 20n)} USDC${r.approved ? "" : " · not approved"}`}</div>
          </li>
        ))}
      </ul>
      <p className="muted">
        On-chain counters in the escrow, updated by the same transitions that emit the events. Recomputed from
        events in the test suite.
      </p>
    </>
  );
}
