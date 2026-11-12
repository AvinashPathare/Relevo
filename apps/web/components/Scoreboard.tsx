import { formatUsdc } from "@elivo/shared/money";
import type { FirmScore } from "@elivo/shared/scoreboard";
import { Chip, Sticker } from "./ui.tsx";

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
    <div className="stack">
      <ul className="grid-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((r) => {
          const s = r.score;
          const exposureMax = BigInt(r.bond) * 20n;
          return (
            <Sticker as="li" key={s.firm} tone={s.penaltiesPaid !== "0" ? "peach" : "paper"}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{r.name}</h3>
                {s.onTimeRate === null ? (
                  <Chip tone="paper">no deliveries yet</Chip>
                ) : (
                  <Chip
                    tone={s.onTimeRate === 1 ? "mint" : "rose"}
                  >{`${Math.round(s.onTimeRate * 100)}% on time`}</Chip>
                )}
              </div>
              <div className="small" style={{ margin: "10px 0" }}>
                {line(r)}
              </div>
              <div className="muted small">{`Bond ${formatUsdc(BigInt(r.bond))} USDC · max open exposure ${formatUsdc(exposureMax)} USDC${r.approved ? "" : " · not approved"}`}</div>
            </Sticker>
          );
        })}
      </ul>
      <p className="muted small">
        On-chain counters in the escrow, updated by the same transitions that emit the events. Recomputed from
        events in the test suite.
      </p>
    </div>
  );
}
