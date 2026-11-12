/**
 * Firm scoreboard (spec F16): on-time record, penalties and volume per firm. Recomputed from the
 * escrow's NEP-297 events, and from the contract's own counters; the e2e test checks they agree.
 * Browser-safe (types only).
 */
import type { ElivoEvent } from "./events.ts";
import type { FirmView } from "./views.ts";

export interface FirmScore {
  firm: string;
  onTime: number;
  late: number;
  /** onTime / (onTime + late), or null before the first delivery. */
  onTimeRate: number | null;
  penaltiesPaid: string;
  volume: string;
  /** Payouts taken away from this firm by a reroute (events only; the contract does not count it). */
  reroutedAway: number;
}

const rate = (onTime: number, late: number) => (onTime + late === 0 ? null : onTime / (onTime + late));

/** `amounts` maps "batch_id:payout_id" to the payout amount (events don't carry it); used for volume. */
export function scoreboardFromEvents(
  events: ElivoEvent[],
  amounts: Record<string, string> = {},
): Record<string, FirmScore> {
  const acc: Record<
    string,
    { onTime: number; late: number; penalties: bigint; volume: bigint; rerouted: number }
  > = {};
  const firm = (id: unknown) => {
    const k = String(id);
    acc[k] ??= { onTime: 0, late: 0, penalties: 0n, volume: 0n, rerouted: 0 };
    return acc[k];
  };
  for (const { event, data } of events) {
    switch (event) {
      case "payout_assigned":
        firm(data.firm_id);
        break;
      case "payout_rerouted":
        firm(data.from_firm).rerouted++;
        firm(data.to_firm);
        break;
      case "penalty_charged":
        firm(data.firm_id).penalties += BigInt(String(data.amount ?? "0"));
        break;
      case "payout_delivered": {
        const f = firm(data.firm_id);
        if (data.on_time === true) f.onTime++;
        else f.late++;
        const amount = amounts[`${data.batch_id}:${data.payout_id}`];
        if (amount) f.volume += BigInt(amount);
        break;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(acc).map(([id, a]) => [
      id,
      {
        firm: id,
        onTime: a.onTime,
        late: a.late,
        onTimeRate: rate(a.onTime, a.late),
        penaltiesPaid: a.penalties.toString(),
        volume: a.volume.toString(),
        reroutedAway: a.rerouted,
      },
    ]),
  );
}

export function scoreboardFromFirms(list: Array<[string, FirmView]>): Record<string, FirmScore> {
  return Object.fromEntries(
    list.map(([id, f]) => [
      id,
      {
        firm: id,
        onTime: f.delivered_on_time,
        late: f.delivered_late,
        onTimeRate: rate(f.delivered_on_time, f.delivered_late),
        penaltiesPaid: String(f.penalties_paid),
        volume: String(f.volume),
        reroutedAway: 0,
      },
    ]),
  );
}
