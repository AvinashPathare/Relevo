/** Pure routing decisions: which firm wins a payout, and what to do with a payout right now. */
import type { PayoutView } from "@elivo/shared/views";

export interface SignedQuote {
  firm_id: string;
  quote_bps: number;
  quote_sig: string;
}

export interface FirmCapacity {
  bond: bigint;
  open_exposure: bigint;
  approved: boolean;
}

export function pickFirm(
  quotes: SignedQuote[],
  firms: Record<string, FirmCapacity>,
  tried: string[],
  amount: bigint,
  multiple = 20n,
): SignedQuote | null {
  const eligible = quotes.filter((q) => {
    const f = firms[q.firm_id];
    return f?.approved && !tried.includes(q.firm_id) && f.open_exposure + amount <= f.bond * multiple;
  });
  eligible.sort((a, b) => a.quote_bps - b.quote_bps || a.firm_id.localeCompare(b.firm_id));
  return eligible[0] ?? null;
}

export type Decision = "assign" | "reroute" | "refund" | "wait" | "done";

export function decide(p: PayoutView, nowNs: bigint, graceNs: bigint): Decision {
  if (p.state === "Delivered" || p.state === "Refunded") return "done";
  const cutoff = BigInt(p.cutoff_ns);
  const deadline = BigInt(p.final_deadline_ns);
  if (p.excluded || nowNs > deadline) return "refund";
  if (p.state === "Funded") return nowNs < cutoff ? "assign" : "wait";
  if (nowNs > cutoff + graceNs && nowNs < deadline) return "reroute";
  return "wait";
}
