import { LABEL } from "@elivo/shared/label";
import { formatUsdc } from "@elivo/shared/money";
import type { Receipt, ReceiptPayout } from "@elivo/shared/receipt";
import { Button, Eyebrow } from "./ui.tsx";

/** What happened to one payout, in words a donor or auditor can read. */
function outcome(p: ReceiptPayout): string {
  if (p.state === "Refunded") return p.excluded ? "Refunded: account closed" : "Refunded: deadline passed";
  if (p.firms_tried.length > 1)
    return `Delivered after reroute (${p.firms_tried.slice(0, -1).join(", ")} missed its cut-off)`;
  return "Delivered";
}

const when = (ns: string | null) =>
  ns ? `${new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 19).replace("T", " ")} UTC` : "-";

/**
 * A one-page summary of a receipt that has passed every check on /verify, for someone who has to show
 * that payouts arrived (a grant-maker to a donor, a finance lead to an auditor). Prints on its own:
 * the print stylesheet hides everything outside `.report`.
 */
export function DeliveryReport({
  receipt: r,
  hash,
  print = () => window.print(),
}: {
  receipt: Receipt;
  hash: string;
  print?: () => void;
}) {
  const delivered = r.payouts.filter((p) => p.state === "Delivered").length;
  const refunded = r.payouts.length - delivered;
  return (
    <section className="report sheet" aria-labelledby="report-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <Eyebrow>For donors and auditors</Eyebrow>
          <h2 id="report-title">Delivery report</h2>
        </div>
        <span className="no-print">
          <Button variant="secondary" onClick={print}>
            Print report
          </Button>
        </span>
      </div>
      <p>{`Batch ${r.batch_id} · funded by ${r.funder} · ${r.network}`}</p>
      <p>{`${r.payouts.length} payouts: ${delivered} delivered, ${refunded} refunded to the funder. ${formatUsdc(BigInt(r.totals.penalties))} USDC in late penalties paid to the funder.`}</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Payee</th>
              <th>USDC</th>
              <th>MXN</th>
              <th>Outcome</th>
              <th>Delivered by</th>
              <th>At</th>
              <th>Penalty</th>
            </tr>
          </thead>
          <tbody>
            {r.payouts.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.clabe_last4 ? `account ****${p.clabe_last4}` : "-"}</td>
                <td>{formatUsdc(BigInt(p.amount_usdc))}</td>
                <td>{p.amount_mxn || "-"}</td>
                <td>{outcome(p)}</td>
                <td>{p.final_firm ?? "-"}</td>
                <td>{when(p.delivered_at_ns)}</td>
                <td>{formatUsdc(BigInt(p.penalties_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">{`Locked ${formatUsdc(BigInt(r.totals.locked))} USDC · paid to firms ${formatUsdc(BigInt(r.totals.paid_to_firms))} USDC · returned to the funder ${formatUsdc(BigInt(r.totals.returned_to_funder))} USDC.`}</p>
      <p className="small">
        Receipt hash <code style={{ wordBreak: "break-all" }}>{hash}</code>
        {`, anchored in ${r.escrow}. Payees are identified only by the last 4 digits of their account. Anyone can repeat this check with the receipt file.`}
      </p>
      <p className="small muted">{LABEL}</p>
    </section>
  );
}
