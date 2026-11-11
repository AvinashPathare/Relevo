/** JSON shapes returned by the escrow's view methods (u64/u128 as strings). */
export type PayoutState = "Funded" | "Assigned" | "Delivered" | "Refunded";

export interface ConfigView {
  owner_id: string;
  token_id: string;
  router_id: string;
  oracle_pk: string;
  receipt_pk: string;
  period_ns: string;
  penalty_bps_per_period: number;
  cap_bps: number;
  max_fee_bps: number;
  exposure_multiple: number;
  reroute_window_ns: string;
  min_payout: string;
  max_batch: number;
  paused: boolean;
}

export interface BatchView {
  id: string;
  funder: string;
  batch_hash: string;
  funded_at_ns: string;
  payout_count: number;
  router_id: string;
  oracle_pk: string;
  receipt_pk: string;
  receipt_hash: string | null;
}

export interface PayoutView {
  batch_id: string;
  id: number;
  amount: string;
  locked: string;
  state: PayoutState;
  firm: string | null;
  quote_bps: number;
  cutoff_ns: string;
  final_deadline_ns: string;
  penalties_total: string;
  firms_tried: string[];
  excluded: boolean;
  delivered_at_ns: string | null;
  proof_ref: string | null;
}

export interface FirmView {
  pk: string;
  approved: boolean;
  bond: string;
  open_exposure: string;
  delivered_on_time: number;
  delivered_late: number;
  penalties_paid: string;
  volume: string;
}
