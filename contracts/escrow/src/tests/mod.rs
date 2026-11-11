//! Contract-level unit tests (near-sdk mocked blockchain).
use crate::*;
use ed25519_dalek::SigningKey;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, CurveType, NearToken, PromiseOrValue, PublicKey};

mod router_tests;

pub const S: u64 = 1_000_000_000;
pub const T0: u64 = 1_000_000 * S;

pub fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
pub fn owner() -> AccountId {
    acc("owner.near")
}
pub fn token() -> AccountId {
    acc("usdc.near")
}
pub fn router() -> AccountId {
    acc("router.near")
}
pub fn funder() -> AccountId {
    acc("dao.near")
}
pub fn mx(n: u8) -> AccountId {
    acc(&format!("mx{n}.near"))
}
pub fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
pub fn near_pk(k: &SigningKey) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, k.verifying_key().as_bytes().to_vec()).unwrap()
}
pub fn oracle() -> SigningKey {
    key(1)
}
pub fn receipt_key() -> SigningKey {
    key(2)
}
pub fn firm_key(n: u8) -> SigningKey {
    key(10 + n)
}

pub fn ctx(pred: &AccountId, deposit: NearToken, now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("escrow.near"))
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(deposit)
        .block_timestamp(now)
        .account_balance(NearToken::from_near(100));
    testing_env!(b.build());
}
pub fn call(pred: &AccountId, now: u64) {
    ctx(pred, NearToken::from_yoctonear(0), now)
}
pub fn call_1y(pred: &AccountId, now: u64) {
    ctx(pred, NearToken::from_yoctonear(1), now)
}

pub fn new_contract() -> Escrow {
    call(&owner(), T0);
    Escrow::new(
        owner(),
        token(),
        router(),
        near_pk(&oracle()),
        near_pk(&receipt_key()),
        true,
    )
}

pub fn fund_msg(amounts: &[u128], cut_s: u64, dl_s: u64) -> String {
    let payouts: Vec<serde_json::Value> = amounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            serde_json::json!({ "id": i, "amount": a.to_string(),
                "cutoff_in_ns": (cut_s * S).to_string(), "deadline_in_ns": (dl_s * S).to_string() })
        })
        .collect();
    serde_json::json!({ "kind": "fund_batch", "batch_hash": "ab".repeat(32),
        "router_id": router(), "oracle_pk": String::from(&near_pk(&oracle())), "payouts": payouts })
    .to_string()
}

pub fn locked_total(amounts: &[u128]) -> u128 {
    amounts.iter().map(|a| a + a * 25 / 10_000).sum()
}

/// Contract with storage credit for the funder, three approved and bonded firms.
pub fn ready_contract() -> Escrow {
    let mut c = new_contract();
    ctx(&funder(), NearToken::from_near(1), T0);
    c.storage_deposit(None);
    for n in 1..=3 {
        ctx(&mx(n), NearToken::from_near(1), T0);
        c.storage_deposit(None);
        call(&mx(n), T0);
        c.register_firm(near_pk(&firm_key(n)));
        call_1y(&owner(), T0);
        c.approve_firm(mx(n));
        call(&token(), T0);
        let _ = c.ft_on_transfer(
            mx(n),
            U128(1_000_000_000_000),
            r#"{"kind":"post_bond"}"#.into(),
        );
    }
    c
}

pub fn fund(c: &mut Escrow, amounts: &[u128], cut_s: u64, dl_s: u64) -> u64 {
    call(&token(), T0);
    let before = c.get_batch_count().0;
    match c.ft_on_transfer(
        funder(),
        U128(locked_total(amounts)),
        fund_msg(amounts, cut_s, dl_s),
    ) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 0),
        _ => panic!("expected value"),
    }
    before
}

#[test]
#[should_panic(expected = "ed25519 key required")]
fn init_rejects_secp_key() {
    call(&owner(), T0);
    let secp = PublicKey::from_parts(CurveType::SECP256K1, vec![1u8; 64]).unwrap();
    Escrow::new(
        owner(),
        token(),
        router(),
        secp,
        near_pk(&receipt_key()),
        true,
    );
}

#[test]
#[should_panic(expected = "token_only")]
fn only_token_can_call_ft_on_transfer() {
    let mut c = ready_contract();
    call(&funder(), T0);
    let _ = c.ft_on_transfer(
        funder(),
        U128(locked_total(&[1_000_000])),
        fund_msg(&[1_000_000], 60, 600),
    );
}

#[test]
fn fund_batch_happy_emits_event() {
    let mut c = ready_contract();
    let id = fund(&mut c, &[1_000_000, 2_000_000], 60, 600);
    let b = c.get_batch(U64(id)).unwrap();
    assert_eq!(b.funder, funder());
    assert_eq!(b.payout_count, 2);
    assert_eq!(b.batch_hash, "ab".repeat(32));
    let ps = c.get_batch_payouts(U64(id));
    assert_eq!(ps.len(), 2);
    assert_eq!(ps[1].locked, U128(2_005_000));
    assert_eq!(ps[0].cutoff_ns, U64(T0 + 60 * S));
    let logs = get_logs();
    let ev = logs
        .iter()
        .find(|l| l.contains("\"batch_funded\""))
        .expect("event");
    assert!(ev.starts_with("EVENT_JSON:"));
    let v: serde_json::Value = serde_json::from_str(&ev["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(v["standard"], "elivo");
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["data"][0]["total_locked"], "3007500");
    assert_eq!(v["data"][0]["funder"], "dao.near");
}

#[test]
#[should_panic(expected = "total_mismatch")]
fn fund_wrong_total_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let _ = c.ft_on_transfer(
        funder(),
        U128(locked_total(&[1_000_001]) - 1),
        fund_msg(&[1_000_001], 60, 600),
    );
}

#[test]
#[should_panic(expected = "bad_msg")]
fn ft_on_transfer_garbage_msg_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let _ = c.ft_on_transfer(funder(), U128(5), "not json".into());
}

#[test]
#[should_panic(expected = "bad_msg")]
fn ft_on_transfer_unknown_kind_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let _ = c.ft_on_transfer(funder(), U128(5), r#"{"kind":"steal"}"#.into());
}

#[test]
#[should_panic(expected = "insufficient_storage_credit")]
fn fund_without_storage_credit_panics() {
    let mut c = ready_contract();
    call(&token(), T0);
    let _ = c.ft_on_transfer(
        acc("nocredit.near"),
        U128(locked_total(&[1_000_000])),
        fund_msg(&[1_000_000], 60, 600),
    );
}

#[test]
#[should_panic(expected = "paused")]
fn fund_while_paused_panics() {
    let mut c = ready_contract();
    call_1y(&owner(), T0);
    c.set_paused(true);
    fund(&mut c, &[1_000_000], 60, 600);
}

#[test]
fn batch_snapshots_keys() {
    let mut c = ready_contract();
    let id = fund(&mut c, &[1_000_000], 60, 600);
    let before = c.get_batch(U64(id)).unwrap().oracle_pk;
    call_1y(&owner(), T0);
    c.set_oracle_pk(near_pk(&key(99)));
    call_1y(&owner(), T0);
    c.set_router(acc("evil.near"));
    let b = c.get_batch(U64(id)).unwrap();
    assert_eq!(b.oracle_pk, before);
    assert_eq!(b.router_id, router());
    assert_eq!(c.get_config().router_id, acc("evil.near"));
}

#[test]
#[should_panic(expected = "unknown_firm")]
fn post_bond_requires_registered_firm() {
    let mut c = ready_contract();
    call(&token(), T0);
    let _ = c.ft_on_transfer(
        acc("stranger.near"),
        U128(10),
        r#"{"kind":"post_bond"}"#.into(),
    );
}

#[test]
#[should_panic(expected = "owner_only")]
fn approve_firm_owner_only() {
    let mut c = ready_contract();
    call_1y(&mx(1), T0);
    c.approve_firm(mx(2));
}

#[test]
fn storage_credit_is_debited_by_funding() {
    let mut c = ready_contract();
    let before = c.storage_balance_of(funder()).0;
    fund(&mut c, &[1_000_000, 1_000_000], 60, 600);
    assert!(c.storage_balance_of(funder()).0 < before);
}

#[test]
fn views_return_strings_for_numbers() {
    let mut c = ready_contract();
    let id = fund(&mut c, &[1_000_000], 60, 600);
    let p = serde_json::to_value(c.get_payout(U64(id), 0).unwrap()).unwrap();
    assert!(p["amount"].is_string());
    assert!(p["cutoff_ns"].is_string());
    assert_eq!(p["state"], "Funded");
    let f = serde_json::to_value(c.get_firm(mx(1)).unwrap()).unwrap();
    assert_eq!(f["bond"], "1000000000000");
    assert!(f["pk"].as_str().unwrap().starts_with("ed25519:"));
    let cfg = serde_json::to_value(c.get_config()).unwrap();
    assert_eq!(cfg["period_ns"], "10000000000");
    assert_eq!(c.list_firms().len(), 3);
}

fn msg_with(router_id: &str, oracle_pk: &str, amounts: &[u128]) -> String {
    let mut v: serde_json::Value = serde_json::from_str(&fund_msg(amounts, 60, 600)).unwrap();
    v["router_id"] = router_id.into();
    v["oracle_pk"] = oracle_pk.into();
    v.to_string()
}

#[test]
#[should_panic(expected = "config_mismatch")]
fn fund_with_rotated_router_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let oracle = String::from(&near_pk(&oracle()));
    let _ = c.ft_on_transfer(
        funder(),
        U128(locked_total(&[1_000_000])),
        msg_with("evil.near", &oracle, &[1_000_000]),
    );
}

#[test]
#[should_panic(expected = "config_mismatch")]
fn fund_with_rotated_oracle_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let evil = String::from(&near_pk(&key(66)));
    let _ = c.ft_on_transfer(
        funder(),
        U128(locked_total(&[1_000_000])),
        msg_with("router.near", &evil, &[1_000_000]),
    );
}

#[test]
#[should_panic(expected = "bad_msg")]
fn fund_without_pinned_config_refunds() {
    let mut c = ready_contract();
    call(&token(), T0);
    let mut v: serde_json::Value = serde_json::from_str(&fund_msg(&[1_000_000], 60, 600)).unwrap();
    v.as_object_mut().unwrap().remove("router_id");
    v.as_object_mut().unwrap().remove("oracle_pk");
    let _ = c.ft_on_transfer(funder(), U128(locked_total(&[1_000_000])), v.to_string());
}

#[test]
#[should_panic(expected = "deposit_below_minimum")]
fn storage_deposit_one_yocto_rejected() {
    let mut c = new_contract();
    ctx(&acc("griefer.near"), NearToken::from_yoctonear(1), T0);
    c.storage_deposit(Some(acc("victim1.near")));
}

#[test]
fn storage_deposit_minimum_accepted_and_topups_any_size() {
    let mut c = new_contract();
    ctx(&funder(), NearToken::from_millinear(10), T0);
    c.storage_deposit(None);
    ctx(&funder(), NearToken::from_yoctonear(1), T0);
    c.storage_deposit(None);
    assert_eq!(c.storage_balance_of(funder()).0, 10u128.pow(22) + 1);
}
