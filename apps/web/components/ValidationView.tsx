import { formatUsdc } from "@elivo/shared/money";
import { Button, Chip, Eyebrow, Sticker, Ticket, Window } from "./ui.tsx";

export interface ValidateResponse {
  ok: boolean;
  errors: Array<{ row: number; reason: string }>;
  rows: Array<{ row: number; name: string; clabe_last4: string; amount_mxn: string; amount_usdc: string }>;
  draft_id?: string;
  total_locked?: string;
}

export interface RouterConfig {
  network: string;
  escrow: string;
  rate: string;
  cutoff_in_s: number | null;
  deadline_in_s: number | null;
  grace_ms: number;
  fee_buffer_bps: number;
}

export function ValidationView({
  result,
  config,
}: {
  result: ValidateResponse;
  config: RouterConfig | null;
}) {
  if (!result.ok)
    return (
      <Sticker tone="rose">
        <Eyebrow>Blocked before anything goes on-chain</Eyebrow>
        <ul className="bad">
          {result.errors.map((e) => (
            <li key={`${e.row}-${e.reason}`}>{e.row > 0 ? `Row ${e.row}: ${e.reason}` : e.reason}</li>
          ))}
        </ul>
        <p>Fix these rows to continue</p>
      </Sticker>
    );
  const payouts = result.rows.reduce((s, r) => s + BigInt(r.amount_usdc), 0n);
  const locked = BigInt(result.total_locked ?? "0");
  return (
    <div className="stack">
      <Window title={`~/new/payees.csv · ${result.rows.length} rows`} status="done">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Payee</th>
                <th>Account</th>
                <th className="num">MXN</th>
                <th className="num">USDC</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row}>
                  <td className="mono">{r.row}</td>
                  <td>{r.name}</td>
                  <td className="mono">{`****${r.clabe_last4}`}</td>
                  <td className="num">{r.amount_mxn}</td>
                  <td className="num">{formatUsdc(BigInt(r.amount_usdc))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>
      <div className="tickets">
        <Ticket tone="paper" label="Payouts" value={formatUsdc(payouts)} unit="USDC" />
        <Ticket
          tone="lavender"
          label={`Fee buffer (${config?.fee_buffer_bps ?? 25} bps)`}
          value={formatUsdc(locked - payouts)}
          unit="USDC"
        />
        <Ticket tone="peach" label="Total to lock" value={formatUsdc(locked)} unit="USDC" />
      </div>
      <div className="row">
        <Chip tone="paper">{`Rate ${config?.rate ?? "18.50"} MXN/USDC (fixed, simulated)`}</Chip>
        {config?.cutoff_in_s != null && (
          <Chip tone="paper">{`Cut-off: ${config.cutoff_in_s} s after funding (demo) · Final deadline: ${config.deadline_in_s} s`}</Chip>
        )}
      </div>
      <p className="muted small">
        Only a salted hash of this list and the amounts go on-chain. Names and account numbers stay with the
        router.
      </p>
      {result.draft_id && (
        <div>
          <Button href={`/batches/${result.draft_id}`}>Continue to proposal</Button>
        </div>
      )}
    </div>
  );
}
