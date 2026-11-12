import { formatUsdc } from "@elivo/shared/money";

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
      <div className="card">
        <ul className="bad">
          {result.errors.map((e) => (
            <li key={`${e.row}-${e.reason}`}>{e.row > 0 ? `Row ${e.row}: ${e.reason}` : e.reason}</li>
          ))}
        </ul>
        <p>Fix these rows to continue</p>
      </div>
    );
  const payouts = result.rows.reduce((s, r) => s + BigInt(r.amount_usdc), 0n);
  const locked = BigInt(result.total_locked ?? "0");
  return (
    <>
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
                <td>{r.row}</td>
                <td>{r.name}</td>
                <td>{`****${r.clabe_last4}`}</td>
                <td className="num">{r.amount_mxn}</td>
                <td className="num">{formatUsdc(BigInt(r.amount_usdc))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div>{`Payouts ${formatUsdc(payouts)} USDC`}</div>
        <div>{`Fee buffer (${config?.fee_buffer_bps ?? 25} bps) ${formatUsdc(locked - payouts)} USDC`}</div>
        <div>
          <strong>{`Total to lock ${formatUsdc(locked)} USDC`}</strong>
        </div>
        <div className="muted">{`Rate ${config?.rate ?? "18.50"} MXN/USDC (fixed, simulated)`}</div>
        {config?.cutoff_in_s != null && (
          <div className="muted">{`Cut-off: ${config.cutoff_in_s} s after funding (demo) · Final deadline: ${config.deadline_in_s} s`}</div>
        )}
        <p className="muted">
          Only a salted hash of this list and the amounts go on-chain. Names and account numbers stay with the
          router.
        </p>
        {result.draft_id && (
          <p>
            <a href={`/batches/${result.draft_id}`}>Continue to proposal</a>
          </p>
        )}
      </div>
    </>
  );
}
