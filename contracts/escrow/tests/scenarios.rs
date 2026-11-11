// `ok(..)` asserts success and returns the result for optional inspection; discarding it is fine.
#![allow(unused_must_use)]
//! Sandbox integration scenarios against the compiled wasm (contracts/res).
mod common;

use common::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const AMT: u128 = 1_000_000_000;

fn u(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

fn u64v(v: &Value) -> u64 {
    v.as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn happy_path() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT, 2 * AMT], 60, 600).await?;
    let mx1 = env.firms[0].id().to_string();
    let (firm_before, funder_before) = (
        balance(&env, &mx1).await?,
        balance(&env, env.funder.id()).await?,
    );
    ok(assign(&env, b, 0, 1, 20).await?);
    let at = now_ns(&env).await?;
    let r = ok(settle(&env, b, 0, 1, at, 1).await?);
    assert!(events(&r).iter().any(|(e, _)| e == "payout_delivered"));
    assert_eq!(
        balance(&env, &mx1).await? - firm_before,
        AMT + AMT * 20 / 10_000
    );
    assert_eq!(
        balance(&env, env.funder.id()).await? - funder_before,
        AMT * 5 / 10_000
    );
    let escrow_bal = balance(&env, env.escrow.id()).await?;
    assert_eq!(escrow_bal, 3 * BOND + locked_total(&[2 * AMT]));
    assert_eq!(payout(&env, b, 0).await?["state"], "Delivered");
    Ok(())
}

#[tokio::test]
async fn late_with_reroute() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT], 5, 600).await?;
    ok(assign(&env, b, 0, 3, 18).await?);
    let cutoff = u64v(&payout(&env, b, 0).await?["cutoff_ns"]);
    wait_past(&env, cutoff + 25 * S).await?;
    let funder_before = balance(&env, env.funder.id()).await?;
    let r = ok(reroute(&env, b, 0, 2, 20).await?);
    let evs = events(&r);
    let (_, pen) = evs
        .iter()
        .find(|(e, _)| e == "penalty_charged")
        .expect("penalty event");
    let penalty = u(&pen["amount"]);
    assert!(penalty >= 3 * AMT / 10_000, "at least 3 periods late");
    assert_eq!(pen["to"], env.funder.id().as_str());
    assert!(evs.iter().any(|(e, _)| e == "payout_rerouted"));
    assert_eq!(
        balance(&env, env.funder.id()).await? - funder_before,
        penalty
    );
    assert_eq!(u(&firm(&env, 3).await?["bond"]), BOND - penalty);
    let at = now_ns(&env).await?;
    let late = settle(&env, b, 0, 3, at, 7).await?;
    assert!(late.is_failure() && failure_text(&late).contains("wrong_firm"));
    ok(settle(&env, b, 0, 2, at, 8).await?);
    assert_eq!(payout(&env, b, 0).await?["state"], "Delivered");
    Ok(())
}

#[tokio::test]
async fn refund_after_deadline() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT], 5, 15).await?;
    ok(assign(&env, b, 0, 1, 20).await?);
    let early = env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": b.to_string(), "payout_id": 0 }))
        .max_gas()
        .transact()
        .await?;
    assert!(failure_text(&early).contains("not_refundable_yet"));
    let dl = u64v(&payout(&env, b, 0).await?["final_deadline_ns"]);
    wait_past(&env, dl).await?;
    let before = balance(&env, env.funder.id()).await?;
    let r = ok(env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": b.to_string(), "payout_id": 0 }))
        .max_gas()
        .transact()
        .await?);
    let evs = events(&r);
    let penalty = evs
        .iter()
        .find(|(e, _)| e == "penalty_charged")
        .map(|(_, d)| u(&d["amount"]))
        .unwrap_or(0);
    assert!(penalty > 0);
    assert_eq!(
        balance(&env, env.funder.id()).await? - before,
        locked_total(&[AMT]) + penalty
    );
    assert_eq!(payout(&env, b, 0).await?["state"], "Refunded");
    Ok(())
}

#[tokio::test]
async fn exclusion_refund() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT], 60, 600).await?;
    ok(assign(&env, b, 0, 2, 20).await?);
    let at = now_ns(&env).await?;
    let (x, sig) = exclusion(&env, b, 0, 2, at, 11);
    let r = ok(router_call(
        &env,
        "exclude",
        json!({ "batch_id": b.to_string(), "payout_id": 0, "exclusion": x, "oracle_sig": sig }),
    )
    .await?);
    assert!(events(&r).iter().any(|(e, _)| e == "payout_excluded"));
    let before = balance(&env, env.funder.id()).await?;
    let r = ok(env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": b.to_string(), "payout_id": 0 }))
        .max_gas()
        .transact()
        .await?);
    assert!(!events(&r).iter().any(|(e, _)| e == "penalty_charged"));
    assert_eq!(
        balance(&env, env.funder.id()).await? - before,
        locked_total(&[AMT])
    );
    assert_eq!(u(&firm(&env, 2).await?["bond"]), BOND);
    Ok(())
}

/// A penalty shrinks a firm's capacity: bond x 20 is the exposure limit, so after paying the 2%
/// cap on a full-size payout the firm can no longer take that size again.
/// (Penalties alone can't drain a bond to zero: 2% cap x 20x exposure = at most 40% per round.)
#[tokio::test]
async fn bond_exhaustion() -> anyhow::Result<()> {
    let env = setup_with_bonds(&[BOND, BOND, 1_000_000]).await?;
    let amt = 20_000_000u128; // the most a 1 USDC bond can carry at 20x
    let b = fund(&env, &[amt], 5, 100_000).await?;
    ok(assign(&env, b, 0, 3, 18).await?);
    let cutoff = u64v(&payout(&env, b, 0).await?["cutoff_ns"]);
    wait_past(&env, cutoff + 2_000 * S).await?; // 200+ periods: at the 2% cap
    let r = ok(reroute(&env, b, 0, 1, 22).await?);
    let pen = events(&r)
        .iter()
        .find(|(e, _)| e == "penalty_charged")
        .map(|(_, d)| u(&d["amount"]))
        .unwrap();
    assert_eq!(pen, 400_000, "capped at 2% of the payout");
    assert_eq!(u(&firm(&env, 3).await?["bond"]), 600_000);
    let b2 = fund(&env, &[amt, 12_000_000], 60, 600).await?;
    let r = assign(&env, b2, 0, 3, 18).await?;
    assert!(
        failure_text(&r).contains("exposure_exceeded"),
        "20 USDC no longer fits a 0.6 USDC bond"
    );
    ok(assign(&env, b2, 1, 3, 18).await?); // 12 USDC = 0.6 x 20 still fits
    assert_eq!(u(&firm(&env, 3).await?["open_exposure"]), 12_000_000);
    Ok(())
}

#[tokio::test]
async fn paused_contract() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT, AMT], 5, 15).await?;
    ok(assign(&env, b, 0, 1, 20).await?);
    ok(env
        .owner
        .call(env.escrow.id(), "set_paused")
        .args_json(json!({ "paused": true }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?);
    let before = balance(&env, env.funder.id()).await?;
    let count = batch_count(&env).await?;
    ft_transfer_call(
        &env.usdc,
        &env.funder,
        env.escrow.id().as_str(),
        locked_total(&[AMT]),
        &fund_msg(&env, &[AMT], 60, 600),
    )
    .await?;
    assert_eq!(
        balance(&env, env.funder.id()).await?,
        before,
        "funding while paused is returned"
    );
    assert_eq!(batch_count(&env).await?, count);
    let r = assign(&env, b, 1, 2, 20).await?;
    assert!(failure_text(&r).contains("paused"));
    let at = now_ns(&env).await?;
    ok(settle(&env, b, 0, 1, at, 21).await?);
    let dl = u64v(&payout(&env, b, 1).await?["final_deadline_ns"]);
    wait_past(&env, dl).await?;
    ok(env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": b.to_string(), "payout_id": 1 }))
        .max_gas()
        .transact()
        .await?);
    assert_eq!(payout(&env, b, 1).await?["state"], "Refunded");
    Ok(())
}

#[tokio::test]
async fn double_settlement_after_reroute() -> anyhow::Result<()> {
    let env = setup().await?;
    let b = fund(&env, &[AMT], 5, 600).await?;
    ok(assign(&env, b, 0, 3, 18).await?);
    let cutoff = u64v(&payout(&env, b, 0).await?["cutoff_ns"]);
    wait_past(&env, cutoff + S).await?;
    ok(reroute(&env, b, 0, 2, 20).await?);
    let at = now_ns(&env).await?;
    let mx2 = env.firms[1].id().to_string();
    let before = balance(&env, &mx2).await?;
    assert!(failure_text(&settle(&env, b, 0, 3, at, 31).await?).contains("wrong_firm"));
    ok(settle(&env, b, 0, 2, at, 32).await?);
    assert!(failure_text(&settle(&env, b, 0, 2, at, 33).await?).contains("wrong_state"));
    assert_eq!(balance(&env, &mx2).await? - before, AMT + AMT * 20 / 10_000);
    Ok(())
}

#[tokio::test]
async fn wrong_token_refunded() -> anyhow::Result<()> {
    let env = setup().await?;
    let root = env.worker.root_account()?;
    let fake_acc = sub(&root, "fake", 20).await?;
    let fake = fake_acc.deploy(&wasm("mock_usdc")).await?.into_result()?;
    ok(fake
        .call("new")
        .args_json(json!({ "owner_id": fake.id(), "total_supply": "0" }))
        .transact()
        .await?);
    register_usdc(&fake, env.escrow.as_account()).await?;
    register_usdc(&fake, &env.funder).await?;
    mint(&fake, &env.funder, 10 * AMT).await?;
    let count = batch_count(&env).await?;
    let before = balance_on(&fake, env.funder.id().as_str()).await?;
    ft_transfer_call(
        &fake,
        &env.funder,
        env.escrow.id().as_str(),
        locked_total(&[AMT]),
        &fund_msg(&env, &[AMT], 60, 600),
    )
    .await?;
    assert_eq!(balance_on(&fake, env.funder.id().as_str()).await?, before);
    assert_eq!(batch_count(&env).await?, count);
    Ok(())
}

async fn balance_on(token: &near_workspaces::Contract, who: &str) -> anyhow::Result<u128> {
    let v: String = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": who }))
        .await?
        .json()?;
    Ok(v.parse()?)
}

#[tokio::test]
async fn events_contain_no_pii() -> anyhow::Result<()> {
    let allowed: HashMap<&str, HashSet<&str>> = [
        (
            "batch_funded",
            vec![
                "batch_id",
                "funder",
                "batch_hash",
                "payout_count",
                "total_locked",
            ],
        ),
        ("firm_registered", vec!["firm_id"]),
        ("firm_approved", vec!["firm_id", "approved"]),
        ("bond_posted", vec!["firm_id", "amount", "bond"]),
        ("bond_withdrawn", vec!["firm_id", "amount", "bond"]),
        (
            "payout_assigned",
            vec!["batch_id", "payout_id", "firm_id", "quote_bps", "cutoff_ns"],
        ),
        (
            "payout_rerouted",
            vec![
                "batch_id",
                "payout_id",
                "from_firm",
                "to_firm",
                "quote_bps",
                "cutoff_ns",
            ],
        ),
        (
            "penalty_charged",
            vec![
                "batch_id",
                "payout_id",
                "firm_id",
                "periods",
                "amount",
                "to",
            ],
        ),
        (
            "payout_delivered",
            vec![
                "batch_id",
                "payout_id",
                "firm_id",
                "delivered_at_ns",
                "on_time",
                "paid_to_firm",
                "fee_returned",
                "proof_ref",
            ],
        ),
        (
            "payout_excluded",
            vec!["batch_id", "payout_id", "firm_id", "reason_code"],
        ),
        (
            "payout_refunded",
            vec!["batch_id", "payout_id", "amount", "to"],
        ),
        ("receipt_anchored", vec!["batch_id", "receipt_hash"]),
        ("transfer_failed", vec!["account_id", "amount"]),
        ("claimed", vec!["account_id", "amount"]),
    ]
    .into_iter()
    .map(|(k, v)| (k, v.into_iter().collect()))
    .collect();

    let env = setup().await?;
    let mut results = vec![];
    let b = fund(&env, &[AMT, AMT, AMT], 5, 600).await?;
    results.push(ok(assign(&env, b, 0, 1, 20).await?));
    results.push(ok(assign(&env, b, 1, 3, 18).await?));
    results.push(ok(assign(&env, b, 2, 2, 20).await?));
    let at = now_ns(&env).await?;
    results.push(ok(settle(&env, b, 0, 1, at, 41).await?));
    let (x, sig) = exclusion(&env, b, 2, 2, at, 42);
    results.push(ok(router_call(
        &env,
        "exclude",
        json!({ "batch_id": b.to_string(), "payout_id": 2, "exclusion": x, "oracle_sig": sig }),
    )
    .await?));
    results.push(ok(env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": b.to_string(), "payout_id": 2 }))
        .max_gas()
        .transact()
        .await?));
    let cutoff = u64v(&payout(&env, b, 1).await?["cutoff_ns"]);
    wait_past(&env, cutoff + S).await?;
    results.push(ok(reroute(&env, b, 1, 2, 20).await?));
    let at = now_ns(&env).await?;
    results.push(ok(settle(&env, b, 1, 2, at, 43).await?));
    results.push(ok(router_call(
        &env,
        "anchor_receipt",
        json!({ "batch_id": b.to_string(), "receipt_hash": bs58::encode([5u8; 32]).into_string() }),
    )
    .await?));

    let mut seen = HashSet::new();
    for r in &results {
        for (name, data) in events(r) {
            let ok_keys = allowed
                .get(name.as_str())
                .unwrap_or_else(|| panic!("undocumented event {name}"));
            for k in data.as_object().unwrap().keys() {
                assert!(
                    ok_keys.contains(k.as_str()),
                    "event {name} has undocumented field {k}"
                );
            }
            seen.insert(name);
        }
    }
    for must in [
        "payout_assigned",
        "payout_delivered",
        "payout_excluded",
        "payout_refunded",
        "payout_rerouted",
        "penalty_charged",
        "receipt_anchored",
    ] {
        assert!(seen.contains(must), "expected to see {must}");
    }
    Ok(())
}
