import type { StatusModel } from "../lib/status.ts";

export interface StatusViewProps {
  model: StatusModel;
  routerOnline: boolean;
  network: "sandbox" | "testnet";
  escrow: string;
  /** RPC URL shown in the verify command. */
  rpc: string;
  receiptUrl?: string;
  /** Shown when the batch is not found. */
  batchId?: string;
  explorer?: string | null;
}

const stateClass: Record<string, string> = {
  Delivered: "ok",
  Refunded: "muted",
  Assigned: "",
  Funded: "muted",
};

export function StatusView({
  model,
  routerOnline,
  escrow,
  rpc,
  receiptUrl,
  batchId,
  explorer,
}: StatusViewProps) {
  const notes = (
    <>
      {!routerOnline && <p className="tag">Router offline: showing on-chain data only</p>}
      {model.paused && (
        <p className="tag bad">Contract paused: no new assignments; settlement and refunds still work</p>
      )}
    </>
  );
  if (!model.found)
    return (
      <>
        {notes}
        <p>{`No batch ${batchId ?? model.batchId ?? "?"} on ${escrow}`}</p>
      </>
    );
  const tx = (hash: string, url: string | null) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {hash.slice(0, 8)}…
      </a>
    ) : (
      <code>{hash.slice(0, 8)}…</code>
    );
  return (
    <>
      {notes}
      <p className="muted">
        Batch {model.batchId} · funded by {model.funder} ·{" "}
        {model.terminal
          ? model.anchored
            ? "complete, receipt anchored"
            : "complete, anchoring receipt…"
          : "in progress"}
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Payee</th>
              <th className="num">USDC</th>
              <th>Status</th>
              <th>Route</th>
              <th className="num">Penalty to DAO</th>
              <th>Proof / txs</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.payee ?? <span className="muted">on-chain only</span>}</td>
                <td className="num">{r.amountUsdc}</td>
                <td className={stateClass[r.state]}>{r.label}</td>
                <td>{r.route || "-"}</td>
                <td className="num">{r.penalty}</td>
                <td>
                  {r.proofRef && <div>{r.proofRef}</div>}
                  {r.txs.map((t) => (
                    <div key={`${t.kind}-${t.hash}`} className="muted">
                      {t.kind} {tx(t.hash, t.url)}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div>
          Locked {model.totals.locked} · delivered {model.totals.delivered} · refunded to DAO{" "}
          {model.totals.refunded} · penalties paid to DAO {model.totals.penalties} USDC
        </div>
        {model.receiptHash && (
          <div>
            Receipt hash on-chain: <code>{model.receiptHash}</code>
            {explorer && (
              <>
                {" "}
                <a href={`${explorer}/address/${escrow}`} target="_blank" rel="noreferrer">
                  escrow on explorer
                </a>
              </>
            )}
          </div>
        )}
        {receiptUrl && model.anchored && (
          <p>
            <a href={receiptUrl} download="receipt.json">
              Download receipt
            </a>
          </p>
        )}
        <pre>{`Verify it yourself: pnpm verify-receipt <file> --chain --rpc ${rpc} --escrow ${escrow}`}</pre>
      </div>
    </>
  );
}
