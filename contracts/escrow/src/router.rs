//! Router-only methods: assign, reroute, settle, exclude, anchor_receipt.
//! The router is the account snapshotted into the batch at funding time.
use near_sdk::json_types::{Base58CryptoHash, Base64VecU8, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::events::emit;
use crate::logic::engine;
use crate::logic::types::{CoreError, Outcome, Payout};
use crate::signing::{
    message, verify, DeliveryProof, DeliveryProofJson, Exclusion, ExclusionJson, Quote,
    EXCLUSION_DOMAIN, PROOF_DOMAIN, QUOTE_DOMAIN, REASON_ACCOUNT_CLOSED,
};
use crate::{Batch, Escrow, EscrowExt};

pub(crate) fn fail(e: CoreError) -> ! {
    env::panic_str(e.as_str())
}

#[near]
impl Escrow {
    pub fn assign(
        &mut self,
        batch_id: U64,
        payout_id: u32,
        firm_id: AccountId,
        quote_bps: u16,
        quote_sig: Base64VecU8,
    ) {
        let batch = self.router_batch(batch_id.0);
        require!(!self.paused, "paused");
        let mut firm = self.firm(&firm_id);
        self.check_quote(
            &firm.pk, batch.id, payout_id, &firm_id, quote_bps, &quote_sig,
        );
        let mut payout = self.payout(batch.id, payout_id);
        engine::assign(
            &self.params,
            &mut payout,
            &firm_id,
            &mut firm,
            quote_bps,
            env::block_timestamp(),
        )
        .unwrap_or_else(|e| fail(e));
        emit(
            "payout_assigned",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id, "firm_id": firm_id,
                    "quote_bps": quote_bps, "cutoff_ns": payout.cutoff_ns.to_string() }),
        );
        self.firms.insert(firm_id, firm);
        self.payouts.insert((batch.id, payout_id), payout);
    }

    pub fn reroute(
        &mut self,
        batch_id: U64,
        payout_id: u32,
        new_firm_id: AccountId,
        quote_bps: u16,
        quote_sig: Base64VecU8,
    ) {
        let batch = self.router_batch(batch_id.0);
        require!(!self.paused, "paused");
        let mut payout = self.payout(batch.id, payout_id);
        let old_id = payout
            .firm
            .clone()
            .unwrap_or_else(|| fail(CoreError::WrongState));
        if old_id == new_firm_id {
            fail(CoreError::FirmAlreadyTried);
        }
        let mut old = self.firm(&old_id);
        let mut new = self.firm(&new_firm_id);
        self.check_quote(
            &new.pk,
            batch.id,
            payout_id,
            &new_firm_id,
            quote_bps,
            &quote_sig,
        );
        let o = engine::reroute(
            &self.params,
            &mut payout,
            &mut old,
            &new_firm_id,
            &mut new,
            quote_bps,
            env::block_timestamp(),
        )
        .unwrap_or_else(|e| fail(e));
        self.emit_penalty(&batch, payout_id, &old_id, &o);
        emit(
            "payout_rerouted",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id, "from_firm": old_id,
                    "to_firm": new_firm_id, "quote_bps": quote_bps,
                    "cutoff_ns": payout.cutoff_ns.to_string() }),
        );
        self.firms.insert(old_id, old);
        self.firms.insert(new_firm_id, new);
        self.payouts.insert((batch.id, payout_id), payout);
        self.send(batch.funder, o.pay_funder);
    }

    pub fn settle(
        &mut self,
        batch_id: U64,
        payout_id: u32,
        proof: DeliveryProofJson,
        oracle_sig: Base64VecU8,
    ) {
        let batch = self.router_batch(batch_id.0);
        let proof = DeliveryProof::from(proof);
        require!(
            proof.batch_id == batch.id && proof.payout_id == payout_id,
            "proof_mismatch"
        );
        require!(!self.used_nonces.contains(&proof.nonce), "nonce_used");
        let msg = message(PROOF_DOMAIN, &env::current_account_id(), &proof);
        require!(
            verify(&batch.oracle_pk, &msg, &oracle_sig.0),
            "bad_oracle_sig"
        );
        let mut payout = self.payout(batch.id, payout_id);
        let mut firm = self.firm(&proof.firm_id);
        let o = engine::settle(
            &self.params,
            &mut payout,
            &proof.firm_id,
            &mut firm,
            proof.delivered_at_ns,
            proof.proof_ref.clone(),
            env::block_timestamp(),
        )
        .unwrap_or_else(|e| fail(e));
        self.used_nonces.insert(proof.nonce);
        self.emit_penalty(&batch, payout_id, &proof.firm_id, &o);
        emit(
            "payout_delivered",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id,
                    "firm_id": proof.firm_id, "delivered_at_ns": proof.delivered_at_ns.to_string(),
                    "on_time": o.periods == 0, "paid_to_firm": o.pay_firm.to_string(),
                    "fee_returned": (o.pay_funder - o.penalty).to_string(),
                    "proof_ref": proof.proof_ref }),
        );
        self.firms.insert(proof.firm_id.clone(), firm);
        self.payouts.insert((batch.id, payout_id), payout);
        self.send(proof.firm_id, o.pay_firm);
        self.send(batch.funder, o.pay_funder);
    }

    pub fn exclude(
        &mut self,
        batch_id: U64,
        payout_id: u32,
        exclusion: ExclusionJson,
        oracle_sig: Base64VecU8,
    ) {
        let batch = self.router_batch(batch_id.0);
        let x = Exclusion::from(exclusion);
        require!(
            x.batch_id == batch.id && x.payout_id == payout_id,
            "proof_mismatch"
        );
        require!(x.reason_code == REASON_ACCOUNT_CLOSED, "bad_reason");
        require!(!self.used_nonces.contains(&x.nonce), "nonce_used");
        let msg = message(EXCLUSION_DOMAIN, &env::current_account_id(), &x);
        require!(
            verify(&batch.oracle_pk, &msg, &oracle_sig.0),
            "bad_oracle_sig"
        );
        let mut payout = self.payout(batch.id, payout_id);
        let mut firm = self.firm(&x.firm_id);
        engine::exclude(&mut payout, &x.firm_id, &mut firm).unwrap_or_else(|e| fail(e));
        self.used_nonces.insert(x.nonce);
        emit(
            "payout_excluded",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id,
                    "firm_id": x.firm_id, "reason_code": x.reason_code }),
        );
        self.firms.insert(x.firm_id, firm);
        self.payouts.insert((batch.id, payout_id), payout);
    }

    pub fn anchor_receipt(&mut self, batch_id: U64, receipt_hash: Base58CryptoHash) {
        let mut batch = self.router_batch(batch_id.0);
        require!(batch.receipt_hash.is_none(), "already_anchored");
        let open = (0..batch.payout_count).any(|i| !self.payout(batch.id, i).state.is_terminal());
        require!(!open, "batch_open");
        let hash: [u8; 32] = receipt_hash.into();
        batch.receipt_hash = Some(hash);
        emit(
            "receipt_anchored",
            json!({ "batch_id": batch.id.to_string(),
                    "receipt_hash": near_sdk::bs58::encode(hash).into_string() }),
        );
        self.batches.insert(batch.id, batch);
    }
}

impl Escrow {
    fn router_batch(&self, id: u64) -> Batch {
        let b = self.batch(id);
        require!(env::predecessor_account_id() == b.router_id, "router_only");
        b
    }

    pub(crate) fn batch(&self, id: u64) -> Batch {
        self.batches
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown_batch"))
    }

    pub(crate) fn payout(&self, batch_id: u64, payout_id: u32) -> Payout {
        self.payouts
            .get(&(batch_id, payout_id))
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown_payout"))
    }

    fn check_quote(
        &self,
        pk: &[u8; 32],
        batch_id: u64,
        payout_id: u32,
        firm_id: &AccountId,
        quote_bps: u16,
        sig: &Base64VecU8,
    ) {
        let q = Quote {
            batch_id,
            payout_id,
            firm_id: firm_id.clone(),
            quote_bps,
        };
        let msg = message(QUOTE_DOMAIN, &env::current_account_id(), &q);
        require!(verify(pk, &msg, &sig.0), "bad_quote_sig");
    }

    pub(crate) fn emit_penalty(
        &self,
        batch: &Batch,
        payout_id: u32,
        firm_id: &AccountId,
        o: &Outcome,
    ) {
        if o.penalty == 0 {
            return;
        }
        emit(
            "penalty_charged",
            json!({ "batch_id": batch.id.to_string(), "payout_id": payout_id, "firm_id": firm_id,
                    "periods": o.periods.to_string(), "amount": o.penalty.to_string(),
                    "to": batch.funder }),
        );
    }
}
