use super::*;
use crate::logic::types::PayoutState;
use crate::signing::*;
use ed25519_dalek::Signer;
use near_sdk::json_types::Base64VecU8;
use near_sdk::{Gas, PromiseError};

const AMT: u128 = 1_000_000_000;

fn escrow_id() -> AccountId {
    acc("escrow.near")
}
fn sign(k: &SigningKey, msg: &[u8]) -> Base64VecU8 {
    Base64VecU8(k.sign(msg).to_bytes().to_vec())
}
fn qsig(n: u8, batch: u64, payout: u32, bps: u16) -> Base64VecU8 {
    let q = Quote {
        batch_id: batch,
        payout_id: payout,
        firm_id: mx(n),
        quote_bps: bps,
    };
    sign(&firm_key(n), &message(QUOTE_DOMAIN, &escrow_id(), &q))
}
fn proof(batch: u64, payout: u32, n: u8, at: u64, nonce: u64) -> (DeliveryProofJson, Base64VecU8) {
    let p = DeliveryProof {
        batch_id: batch,
        payout_id: payout,
        firm_id: mx(n),
        delivered_at_ns: at,
        proof_ref: format!("CEP-SIM-{nonce}"),
        nonce,
    };
    let sig = sign(&oracle(), &message(PROOF_DOMAIN, &escrow_id(), &p));
    let j = DeliveryProofJson {
        batch_id: U64(batch),
        payout_id: payout,
        firm_id: mx(n),
        delivered_at_ns: U64(at),
        proof_ref: p.proof_ref.clone(),
        nonce: U64(nonce),
    };
    (j, sig)
}
fn exclusion(
    batch: u64,
    payout: u32,
    n: u8,
    reason: u8,
    nonce: u64,
) -> (ExclusionJson, Base64VecU8) {
    let x = Exclusion {
        batch_id: batch,
        payout_id: payout,
        firm_id: mx(n),
        reason_code: reason,
        observed_at_ns: T0,
        nonce,
    };
    let sig = sign(&oracle(), &message(EXCLUSION_DOMAIN, &escrow_id(), &x));
    let j = ExclusionJson {
        batch_id: U64(batch),
        payout_id: payout,
        firm_id: mx(n),
        reason_code: reason,
        observed_at_ns: U64(T0),
        nonce: U64(nonce),
    };
    (j, sig)
}
fn as_router(now: u64) {
    call(&router(), now);
}
/// Funded batch of two payouts (cut-off 60 s, deadline 600 s); payout 0 assigned to `n`.
fn with_assigned(n: u8) -> (Escrow, u64) {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT, AMT], 60, 600);
    as_router(T0);
    c.assign(U64(b), 0, mx(n), 20, qsig(n, b, 0, 20));
    (c, b)
}
fn has_event(name: &str) -> bool {
    get_logs()
        .iter()
        .any(|l| l.contains(&format!("\"event\":\"{name}\"")))
}

#[test]
#[should_panic(expected = "router_only")]
fn assign_router_only() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call(&mx(1), T0);
    c.assign(U64(b), 0, mx(1), 20, qsig(1, b, 0, 20));
}

#[test]
#[should_panic(expected = "bad_quote_sig")]
fn assign_bad_quote_sig_rejected() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    as_router(T0);
    c.assign(U64(b), 0, mx(1), 20, qsig(2, b, 0, 20));
}

#[test]
#[should_panic(expected = "bad_quote_sig")]
fn assign_quote_for_other_bps_rejected() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    as_router(T0);
    c.assign(U64(b), 0, mx(1), 18, qsig(1, b, 0, 20));
}

#[test]
#[should_panic(expected = "firm_not_approved")]
fn assign_unapproved_firm_rejected() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call_1y(&owner(), T0);
    c.revoke_firm(mx(1));
    as_router(T0);
    c.assign(U64(b), 0, mx(1), 20, qsig(1, b, 0, 20));
}

#[test]
fn assign_emits_event_with_quote() {
    let (c, b) = with_assigned(1);
    assert!(has_event("payout_assigned"));
    assert!(get_logs().iter().any(|l| l.contains("\"quote_bps\":20")));
    assert_eq!(c.get_payout(U64(b), 0).unwrap().firm, Some(mx(1)));
    assert_eq!(c.get_firm(mx(1)).unwrap().open_exposure, U128(AMT));
}

#[test]
fn settle_happy_emits_delivered() {
    let (mut c, b) = with_assigned(1);
    let (p, s) = proof(b, 0, 1, T0 + S, 1);
    as_router(T0 + 2 * S);
    c.settle(U64(b), 0, p, s);
    assert_eq!(
        c.get_payout(U64(b), 0).unwrap().state,
        PayoutState::Delivered
    );
    assert!(has_event("payout_delivered"));
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"paid_to_firm\":\"1002000000\"")));
}

#[test]
#[should_panic(expected = "bad_oracle_sig")]
fn settle_bad_oracle_sig_rejected() {
    let (mut c, b) = with_assigned(1);
    let (p, _) = proof(b, 0, 1, T0, 1);
    let bad = sign(&key(77), b"nope");
    as_router(T0);
    c.settle(U64(b), 0, p, bad);
}

#[test]
#[should_panic(expected = "nonce_used")]
fn settle_reused_nonce_rejected() {
    let (mut c, b) = with_assigned(1);
    as_router(T0);
    c.assign(U64(b), 1, mx(1), 20, qsig(1, b, 1, 20));
    let (p, s) = proof(b, 0, 1, T0, 5);
    c.settle(U64(b), 0, p, s);
    let (p, s) = proof(b, 1, 1, T0, 5);
    c.settle(U64(b), 1, p, s);
}

#[test]
#[should_panic(expected = "proof_mismatch")]
fn settle_proof_for_other_payout_rejected() {
    let (mut c, b) = with_assigned(1);
    let (p, s) = proof(b, 1, 1, T0, 1);
    as_router(T0);
    c.settle(U64(b), 0, p, s);
}

#[test]
#[should_panic(expected = "wrong_firm")]
fn settle_by_previous_firm_after_reroute_rejected() {
    let (mut c, b) = with_assigned(3);
    let late = T0 + 61 * S;
    as_router(late);
    c.reroute(U64(b), 0, mx(2), 20, qsig(2, b, 0, 20));
    let (p, s) = proof(b, 0, 3, late, 9);
    c.settle(U64(b), 0, p, s);
}

#[test]
fn reroute_charges_and_emits() {
    let (mut c, b) = with_assigned(3);
    let late = T0 + 90 * S; // 30 s late = 3 periods
    as_router(late);
    c.reroute(U64(b), 0, mx(2), 20, qsig(2, b, 0, 20));
    assert!(has_event("payout_rerouted"));
    assert!(has_event("penalty_charged"));
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"amount\":\"300000\"") && l.contains("\"to\":\"dao.near\"")));
    assert_eq!(
        c.get_firm(mx(3)).unwrap().bond,
        U128(1_000_000_000_000 - 300_000)
    );
}

#[test]
#[should_panic(expected = "bad_reason")]
fn exclude_bad_reason_rejected() {
    let (mut c, b) = with_assigned(1);
    let (x, s) = exclusion(b, 0, 1, 2, 3);
    as_router(T0);
    c.exclude(U64(b), 0, x, s);
}

#[test]
fn exclude_then_refund_immediately() {
    let (mut c, b) = with_assigned(1);
    let (x, s) = exclusion(b, 0, 1, REASON_ACCOUNT_CLOSED, 3);
    as_router(T0);
    c.exclude(U64(b), 0, x, s);
    assert!(has_event("payout_excluded"));
    call(&acc("stranger.near"), T0 + S);
    c.refund(U64(b), 0);
    assert_eq!(
        c.get_payout(U64(b), 0).unwrap().state,
        PayoutState::Refunded
    );
    assert_eq!(c.get_firm(mx(1)).unwrap().bond, U128(1_000_000_000_000));
}

#[test]
fn refund_by_stranger_after_deadline_ok() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call(&acc("stranger.near"), T0 + 601 * S);
    c.refund(U64(b), 0);
    assert_eq!(
        c.get_payout(U64(b), 0).unwrap().state,
        PayoutState::Refunded
    );
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("payout_refunded") && l.contains("\"amount\":\"1002500000\"")));
}

#[test]
#[should_panic(expected = "not_refundable_yet")]
fn refund_before_deadline_rejected() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call(&acc("stranger.near"), T0 + 600 * S);
    c.refund(U64(b), 0);
}

fn paused(mut c: Escrow) -> Escrow {
    call_1y(&owner(), T0);
    c.set_paused(true);
    c
}

#[test]
#[should_panic(expected = "paused")]
fn paused_blocks_assign() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    let mut c = paused(c);
    as_router(T0);
    c.assign(U64(b), 0, mx(1), 20, qsig(1, b, 0, 20));
}

#[test]
#[should_panic(expected = "paused")]
fn paused_blocks_reroute() {
    let (c, b) = with_assigned(3);
    let mut c = paused(c);
    as_router(T0 + 61 * S);
    c.reroute(U64(b), 0, mx(2), 20, qsig(2, b, 0, 20));
}

#[test]
fn paused_allows_settle_and_refund() {
    let (c, b) = with_assigned(1);
    let mut c = paused(c);
    let (p, s) = proof(b, 0, 1, T0, 1);
    as_router(T0);
    c.settle(U64(b), 0, p, s);
    call(&acc("stranger.near"), T0 + 601 * S);
    c.refund(U64(b), 1);
    assert_eq!(
        c.get_payout(U64(b), 0).unwrap().state,
        PayoutState::Delivered
    );
    assert_eq!(
        c.get_payout(U64(b), 1).unwrap().state,
        PayoutState::Refunded
    );
}

#[test]
fn failed_transfer_credits_claimable() {
    let mut c = ready_contract();
    call(&escrow_id(), T0);
    c.on_transfer_done(funder(), U128(100), Err(PromiseError::Failed));
    assert_eq!(c.get_claimable(funder()), U128(100));
    assert!(has_event("transfer_failed"));
    call(&escrow_id(), T0);
    c.on_transfer_done(funder(), U128(50), Ok(()));
    assert_eq!(c.get_claimable(funder()), U128(100));
}

#[test]
fn claim_pays_and_clears() {
    let mut c = ready_contract();
    call(&escrow_id(), T0);
    c.on_transfer_done(funder(), U128(100), Err(PromiseError::Failed));
    call(&funder(), T0);
    c.claim();
    assert_eq!(c.get_claimable(funder()), U128(0));
    assert!(has_event("claimed"));
}

#[test]
#[should_panic(expected = "nothing_to_claim")]
fn claim_without_balance_rejected() {
    let mut c = ready_contract();
    call(&funder(), T0);
    c.claim();
}

#[test]
#[should_panic(expected = "batch_open")]
fn anchor_receipt_rejected_while_open() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    as_router(T0);
    c.anchor_receipt(U64(b), [9u8; 32].into());
}

#[test]
fn anchor_receipt_once_when_closed() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call(&acc("stranger.near"), T0 + 601 * S);
    c.refund(U64(b), 0);
    as_router(T0 + 602 * S);
    c.anchor_receipt(U64(b), [9u8; 32].into());
    assert!(c.get_batch(U64(b)).unwrap().receipt_hash.is_some());
    assert!(has_event("receipt_anchored"));
}

#[test]
#[should_panic(expected = "already_anchored")]
fn anchor_receipt_twice_rejected() {
    let mut c = ready_contract();
    let b = fund(&mut c, &[AMT], 60, 600);
    call(&acc("stranger.near"), T0 + 601 * S);
    c.refund(U64(b), 0);
    as_router(T0 + 602 * S);
    c.anchor_receipt(U64(b), [9u8; 32].into());
    c.anchor_receipt(U64(b), [8u8; 32].into());
}

#[test]
#[should_panic(expected = "bond_too_low")]
fn withdraw_bond_respects_exposure() {
    let (mut c, _b) = with_assigned(1);
    call(&mx(1), T0);
    c.withdraw_bond(U128(1_000_000_000_000));
}

#[test]
fn withdraw_bond_within_limit() {
    let (mut c, _b) = with_assigned(1);
    call(&mx(1), T0);
    c.withdraw_bond(U128(1_000_000_000_000 - AMT / 20));
    assert_eq!(c.get_firm(mx(1)).unwrap().bond, U128(AMT / 20));
}

#[test]
fn owner_cannot_move_escrow() {
    let (mut c, b) = with_assigned(1);
    let before = serde_json::to_string(&c.get_batch_payouts(U64(b))).unwrap();
    let firms_before = serde_json::to_string(&c.list_firms()).unwrap();
    call_1y(&owner(), T0);
    c.set_router(owner());
    call_1y(&owner(), T0);
    c.set_oracle_pk(near_pk(&key(50)));
    call_1y(&owner(), T0);
    c.set_receipt_pk(near_pk(&key(51)));
    call_1y(&owner(), T0);
    c.set_paused(true);
    call_1y(&owner(), T0);
    c.set_paused(false);
    // The owner, now also "router", still can't act on a batch whose router was snapshotted.
    assert_eq!(c.get_batch(U64(b)).unwrap().router_id, router());
    assert_eq!(
        serde_json::to_string(&c.get_batch_payouts(U64(b))).unwrap(),
        before
    );
    assert_eq!(
        serde_json::to_string(&c.list_firms()).unwrap(),
        firms_before
    );
    assert_eq!(c.get_claimable(owner()), U128(0));
    let _ = Gas::from_tgas(1);
}

#[test]
#[should_panic(expected = "router_only")]
fn owner_as_new_router_cannot_settle_old_batch() {
    let (mut c, b) = with_assigned(1);
    call_1y(&owner(), T0);
    c.set_router(owner());
    let (p, s) = proof(b, 0, 1, T0, 1);
    call(&owner(), T0);
    c.settle(U64(b), 0, p, s);
}
