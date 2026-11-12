import type { StatusModel, StatusRow } from "../lib/status.ts";
import { Button, Chip, Eyebrow, Progress, Sticker, Ticket, Window } from "./ui.tsx";

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

function stateTone(r: StatusRow): "mint" | "lavender" | "peach" | "paper" | "rose" {
  if (r.state === "Delivered") return "mint";
  if (r.state === "Refunded") return "lavender";
  if (r.state === "Assigned" && r.route.includes("→")) return "peach";
  return "paper";
}

/** "MX-3 → MX-1": every firm before the last missed its cut-off. */
function Route({ row }: { row: StatusRow }) {
  if (!row.route) return <span className="muted">-</span>;
  const firms = row.route.split(" → ");
  return (
    <span className="route">
      {firms.map((f, i) => (
        <span key={`${f}-${i}`} className="route">
          {i > 0 && <span aria-hidden="true">→</span>}
          <Chip tone={i < firms.length - 1 ? "rose" : row.state === "Delivered" ? "mint" : "paper"}>{f}</Chip>
        </span>
      ))}
    </span>
  );
}

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
    <div className="row">
      {!routerOnline && <p className="tag">Router offline: showing on-chain data only</p>}
      {model.paused && (
        <p className="tag bad">Contract paused: no new assignments; settlement and refunds still work</p>
      )}
    </div>
  );
  if (!model.found)
    return (
      <>
        {notes}
        <Sticker tone="rose">
          <p>{`No batch ${batchId ?? model.batchId ?? "?"} on ${escrow}`}</p>
        </Sticker>
      </>
    );
  const tx = (hash: string, url: string | null) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="mono">
        {hash.slice(0, 8)}…
      </a>
    ) : (
      <code>{hash.slice(0, 8)}…</code>
    );
  const finalCount = model.rows.filter((r) => r.state === "Delivered" || r.state === "Refunded").length;
  const status = model.terminal
    ? model.anchored
      ? "complete, receipt anchored"
      : "complete, anchoring receipt…"
    : "in progress";
  return (
    <div className="stack">
      {notes}
      <div className="row">
        <Chip tone={model.terminal ? "mint" : "peach"}>{status}</Chip>
        <span className="muted small">
          Batch {model.batchId} · funded by <span className="mono">{model.funder}</span>
        </span>
      </div>

      <div className="tickets">
        <Ticket tone="paper" label="Locked" value={model.totals.locked} unit="USDC" />
        <Ticket tone="mint" label="Delivered" value={model.totals.delivered} unit="USDC" />
        <Ticket tone="lavender" label="Refunded to DAO" value={model.totals.refunded} unit="USDC" />
        <Ticket tone="peach" label="Penalties to DAO" value={model.totals.penalties} unit="USDC" />
      </div>

      <Window
        title={`~/batches/${model.batchId}`}
        status={!routerOnline ? "offline" : model.terminal && model.anchored ? "done" : "live"}
      >
        <Progress
          value={finalCount}
          max={model.rows.length}
          label={`${finalCount} of ${model.rows.length} payouts final`}
        />
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
                  <td className="mono">{r.id}</td>
                  <td>{r.payee ?? <span className="muted small">on-chain only</span>}</td>
                  <td className={`num${r.state === "Delivered" ? " pos" : ""}`}>{r.amountUsdc}</td>
                  <td>
                    <Chip tone={stateTone(r)}>{r.label}</Chip>
                  </td>
                  <td>
                    <Route row={r} />
                  </td>
                  <td className="num">
                    {r.penalty === "0.00" ? (
                      <span className="muted">0.00</span>
                    ) : (
                      <Chip tone="peach">{r.penalty}</Chip>
                    )}
                  </td>
                  <td className="small">
                    {r.proofRef && <div className="mono">{r.proofRef}</div>}
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
      </Window>

      <Sticker tone="ink">
        <Eyebrow>Signed receipt</Eyebrow>
        {model.receiptHash ? (
          <p>
            Receipt hash on-chain: <code style={{ wordBreak: "break-all" }}>{model.receiptHash}</code>
            {explorer && (
              <>
                {" "}
                <a href={`${explorer}/address/${escrow}`} target="_blank" rel="noreferrer">
                  escrow on explorer
                </a>
              </>
            )}
          </p>
        ) : (
          <p>The router signs the receipt and anchors its hash once every payout is delivered or refunded.</p>
        )}
        {receiptUrl && model.anchored && (
          <p>
            <Button href={receiptUrl} download="receipt.json" variant="primary">
              Download receipt
            </Button>
          </p>
        )}
        <pre>{`Verify it yourself: pnpm verify-receipt <file> --chain --rpc ${rpc} --escrow ${escrow}`}</pre>
      </Sticker>
    </div>
  );
}
