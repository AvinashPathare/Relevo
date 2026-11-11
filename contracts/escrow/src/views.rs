//! JSON views. Every u64/u128 is a string; keys are `ed25519:<base58>`.
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

use crate::logic::types::{Firm, Payout, PayoutState};
use crate::{pk_string, Batch, Escrow, EscrowExt};

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub router_id: AccountId,
    pub oracle_pk: String,
    pub receipt_pk: String,
    pub period_ns: U64,
    pub penalty_bps_per_period: u16,
    pub cap_bps: u16,
    pub max_fee_bps: u16,
    pub exposure_multiple: u32,
    pub reroute_window_ns: U64,
    pub min_payout: U128,
    pub max_batch: u32,
    pub paused: bool,
}

#[near(serializers = [json])]
pub struct BatchView {
    pub id: U64,
    pub funder: AccountId,
    pub batch_hash: String,
    pub funded_at_ns: U64,
    pub payout_count: u32,
    pub router_id: AccountId,
    pub oracle_pk: String,
    pub receipt_pk: String,
    pub receipt_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct PayoutView {
    pub batch_id: U64,
    pub id: u32,
    pub amount: U128,
    pub locked: U128,
    pub state: PayoutState,
    pub firm: Option<AccountId>,
    pub quote_bps: u16,
    pub cutoff_ns: U64,
    pub final_deadline_ns: U64,
    pub penalties_total: U128,
    pub firms_tried: Vec<AccountId>,
    pub excluded: bool,
    pub delivered_at_ns: Option<U64>,
    pub proof_ref: Option<String>,
}

#[near(serializers = [json])]
pub struct FirmView {
    pub pk: String,
    pub approved: bool,
    pub bond: U128,
    pub open_exposure: U128,
    pub delivered_on_time: u32,
    pub delivered_late: u32,
    pub penalties_paid: U128,
    pub volume: U128,
}

fn batch_view(b: &Batch) -> BatchView {
    BatchView {
        id: U64(b.id),
        funder: b.funder.clone(),
        batch_hash: hex::encode(b.batch_hash),
        funded_at_ns: U64(b.funded_at_ns),
        payout_count: b.payout_count,
        router_id: b.router_id.clone(),
        oracle_pk: pk_string(&b.oracle_pk),
        receipt_pk: pk_string(&b.receipt_pk),
        receipt_hash: b
            .receipt_hash
            .map(|h| near_sdk::bs58::encode(h).into_string()),
    }
}

fn payout_view(batch_id: u64, id: u32, p: &Payout) -> PayoutView {
    PayoutView {
        batch_id: U64(batch_id),
        id,
        amount: U128(p.amount),
        locked: U128(p.locked),
        state: p.state,
        firm: p.firm.clone(),
        quote_bps: p.quote_bps,
        cutoff_ns: U64(p.cutoff_ns),
        final_deadline_ns: U64(p.final_deadline_ns),
        penalties_total: U128(p.penalties_total),
        firms_tried: p.firms_tried.clone(),
        excluded: p.excluded,
        delivered_at_ns: p.delivered_at_ns.map(U64),
        proof_ref: p.proof_ref.clone(),
    }
}

fn firm_view(f: &Firm) -> FirmView {
    FirmView {
        pk: pk_string(&f.pk),
        approved: f.approved,
        bond: U128(f.bond),
        open_exposure: U128(f.open_exposure),
        delivered_on_time: f.delivered_on_time,
        delivered_late: f.delivered_late,
        penalties_paid: U128(f.penalties_paid),
        volume: U128(f.volume),
    }
}

#[near]
impl Escrow {
    pub fn get_config(&self) -> ConfigView {
        let p = &self.params;
        ConfigView {
            owner_id: self.owner_id.clone(),
            token_id: self.token_id.clone(),
            router_id: self.router_id.clone(),
            oracle_pk: pk_string(&self.oracle_pk),
            receipt_pk: pk_string(&self.receipt_pk),
            period_ns: U64(p.period_ns),
            penalty_bps_per_period: p.penalty_bps_per_period,
            cap_bps: p.cap_bps,
            max_fee_bps: p.max_fee_bps,
            exposure_multiple: p.exposure_multiple,
            reroute_window_ns: U64(p.reroute_window_ns),
            min_payout: U128(p.min_payout),
            max_batch: p.max_batch,
            paused: self.paused,
        }
    }

    pub fn get_batch(&self, batch_id: U64) -> Option<BatchView> {
        self.batches.get(&batch_id.0).map(batch_view)
    }

    pub fn get_payout(&self, batch_id: U64, payout_id: u32) -> Option<PayoutView> {
        self.payouts
            .get(&(batch_id.0, payout_id))
            .map(|p| payout_view(batch_id.0, payout_id, p))
    }

    pub fn get_batch_payouts(&self, batch_id: U64) -> Vec<PayoutView> {
        let Some(b) = self.batches.get(&batch_id.0) else {
            return vec![];
        };
        (0..b.payout_count)
            .filter_map(|i| self.get_payout(batch_id, i))
            .collect()
    }

    pub fn get_firm(&self, firm_id: AccountId) -> Option<FirmView> {
        self.firms.get(&firm_id).map(firm_view)
    }

    pub fn list_firms(&self) -> Vec<(AccountId, FirmView)> {
        self.firms
            .iter()
            .map(|(id, f)| (id.clone(), firm_view(f)))
            .collect()
    }

    pub fn get_claimable(&self, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_batch_count(&self) -> U64 {
        U64(self.next_batch_id)
    }
}
