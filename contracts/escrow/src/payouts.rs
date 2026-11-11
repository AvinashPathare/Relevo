//! Permissionless refunds and firm bond withdrawal. Both work while paused.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::events::emit;
use crate::logic::engine;
use crate::logic::types::PayoutState;
use crate::router::fail;
use crate::{Escrow, EscrowExt};

#[near]
impl Escrow {
    /// Anyone may refund a payout after its final deadline, or at once if it was excluded.
    pub fn refund(&mut self, batch_id: U64, payout_id: u32) {
        let batch = self.batch(batch_id.0);
        let mut payout = self.payout(batch.id, payout_id);
        let charge_firm = payout.state == PayoutState::Assigned && !payout.excluded;
        let firm_id = if charge_firm {
            payout.firm.clone()
        } else {
            None
        };
        let mut firm = firm_id.as_ref().map(|id| self.firm(id));
        let o = engine::refund(
            &self.params,
            &mut payout,
            firm.as_mut(),
            env::block_timestamp(),
        )
        .unwrap_or_else(|e| fail(e));
        if let (Some(id), Some(f)) = (firm_id.as_ref(), firm) {
            self.emit_penalty(&batch, payout_id, id, &o);
            self.firms.insert(id.clone(), f);
        }
        emit(
            "payout_refunded",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id,
                    "amount": o.pay_funder.to_string(), "to": batch.funder }),
        );
        self.payouts.insert((batch.id, payout_id), payout);
        self.send(batch.funder, o.pay_funder);
    }

    /// A firm withdraws bond above what its open exposure requires.
    pub fn withdraw_bond(&mut self, amount: U128) {
        let firm_id = env::predecessor_account_id();
        let mut firm = self.firm(&firm_id);
        engine::withdraw_bond(&self.params, &mut firm, amount.0).unwrap_or_else(|e| fail(e));
        emit(
            "bond_withdrawn",
            json!({ "firm_id": firm_id, "amount": amount.0.to_string(), "bond": firm.bond.to_string() }),
        );
        self.firms.insert(firm_id.clone(), firm);
        self.send(firm_id, amount.0);
    }
}
