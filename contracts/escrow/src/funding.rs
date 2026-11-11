//! `ft_on_transfer`: batch funding and bond posting. Any invalid transfer panics, so the token's
//! `ft_resolve_transfer` returns the full amount and all state rolls back.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::events::emit;
use crate::logic::engine;
use crate::logic::types::PayoutIn;
use crate::{Batch, Escrow, EscrowExt};

#[near(serializers = [json])]
pub struct PayoutInJson {
    pub id: u32,
    pub amount: U128,
    pub cutoff_in_ns: U64,
    pub deadline_in_ns: U64,
}

#[near(serializers = [json])]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TransferMsg {
    FundBatch {
        batch_hash: String,
        payouts: Vec<PayoutInJson>,
    },
    PostBond,
}

#[near]
impl Escrow {
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token_id, "token_only");
        let parsed: TransferMsg =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("bad_msg"));
        match parsed {
            TransferMsg::FundBatch {
                batch_hash,
                payouts,
            } => self.fund_batch(sender_id, amount.0, batch_hash, payouts),
            TransferMsg::PostBond => self.post_bond(sender_id, amount.0),
        }
        PromiseOrValue::Value(U128(0))
    }
}

impl Escrow {
    fn fund_batch(
        &mut self,
        funder: AccountId,
        amount: u128,
        hash_hex: String,
        items: Vec<PayoutInJson>,
    ) {
        require!(!self.paused, "paused");
        let hash: [u8; 32] = hex::decode(&hash_hex)
            .ok()
            .and_then(|v| v.try_into().ok())
            .unwrap_or_else(|| env::panic_str("bad_batch_hash"));
        let items: Vec<PayoutIn> = items
            .into_iter()
            .map(|p| PayoutIn {
                id: p.id,
                amount: p.amount.0,
                cutoff_in_ns: p.cutoff_in_ns.0,
                deadline_in_ns: p.deadline_in_ns.0,
            })
            .collect();
        let now = env::block_timestamp();
        let payouts = engine::new_payouts(&self.params, &items, amount, now)
            .unwrap_or_else(|e| env::panic_str(e.as_str()));
        let before = env::storage_usage();
        let id = self.next_batch_id;
        self.next_batch_id += 1;
        let count = payouts.len() as u32;
        for (i, p) in payouts.into_iter().enumerate() {
            self.payouts.insert((id, i as u32), p);
        }
        self.batches.insert(
            id,
            Batch {
                id,
                funder: funder.clone(),
                batch_hash: hash,
                funded_at_ns: now,
                payout_count: count,
                router_id: self.router_id.clone(),
                oracle_pk: self.oracle_pk,
                receipt_pk: self.receipt_pk,
                receipt_hash: None,
            },
        );
        self.charge_storage(&funder, before);
        emit(
            "batch_funded",
            json!({ "batch_id": id.to_string(), "funder": funder, "batch_hash": hash_hex,
                    "payout_count": count, "total_locked": amount.to_string() }),
        );
    }

    fn post_bond(&mut self, firm_id: AccountId, amount: u128) {
        let mut firm = self.firm(&firm_id);
        engine::post_bond(&mut firm, amount);
        let bond = firm.bond;
        self.firms.insert(firm_id.clone(), firm);
        emit(
            "bond_posted",
            json!({ "firm_id": firm_id, "amount": amount.to_string(), "bond": bond.to_string() }),
        );
    }
}
