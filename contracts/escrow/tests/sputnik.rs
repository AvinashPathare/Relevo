//! Sputnik DAO v2 (2.3.x, the testnet factory default) funds a batch through a FunctionCall
//! proposal. Requires `.cache/sputnikdao2.wasm` (run `node scripts/fetch-sputnik.mjs`).
#![allow(unused_must_use)]
mod common;

use common::*;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const AMT: u128 = 1_000_000_000;

struct Dao {
    contract: Contract,
    council: Account,
}

fn sputnik_wasm() -> Vec<u8> {
    let p = format!(
        "{}/../../.cache/sputnikdao2.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&p)
        .unwrap_or_else(|_| panic!("missing {p}; run `node scripts/fetch-sputnik.mjs`"))
}

async fn dao_setup(env: &Env) -> anyhow::Result<Dao> {
    let root = env.worker.root_account()?;
    let council = sub(&root, "council", 20).await?;
    let dao_acc = sub(&root, "dao", 30).await?;
    let contract = dao_acc.deploy(&sputnik_wasm()).await?.into_result()?;
    ok(contract
        .call("new")
        .args_json(json!({
            "config": { "name": "elivo-test", "purpose": "test", "metadata": "" },
            "policy": [council.id()],
        }))
        .max_gas()
        .transact()
        .await?);
    register_usdc(&env.usdc, contract.as_account()).await?;
    mint(&env.usdc, contract.as_account(), 10 * AMT).await?;
    ok(env
        .funder
        .call(env.escrow.id(), "storage_deposit")
        .args_json(json!({ "account_id": contract.id() }))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?);
    Ok(Dao { contract, council })
}

fn proposal_kind(env: &Env, amounts: &[u128], cut_s: u64, dl_s: u64) -> Value {
    let args = json!({
        "receiver_id": env.escrow.id(),
        "amount": locked_total(amounts).to_string(),
        "msg": fund_msg(env, amounts, cut_s, dl_s),
    });
    json!({ "FunctionCall": {
        "receiver_id": env.usdc.id(),
        "actions": [{
            "method_name": "ft_transfer_call",
            "args": b64(args.to_string().as_bytes()),
            "deposit": "1",
            "gas": "150000000000000",
        }],
    }})
}

async fn propose(env: &Env, dao: &Dao, kind: &Value) -> anyhow::Result<u64> {
    let policy: Value = dao
        .contract
        .view("get_policy")
        .args_json(json!({}))
        .await?
        .json()?;
    let bond: u128 = policy["proposal_bond"].as_str().unwrap().parse()?;
    let r = ok(dao
        .council
        .call(dao.contract.id(), "add_proposal")
        .args_json(
            json!({ "proposal": { "description": "Elivo payout batch (test)", "kind": kind } }),
        )
        .deposit(NearToken::from_yoctonear(bond))
        .max_gas()
        .transact()
        .await?);
    let _ = env;
    Ok(r.json::<u64>()?)
}

/// v2.3.x expects `proposal` (the kind) alongside the vote; it must match the stored proposal.
async fn vote(dao: &Dao, id: u64, action: &str, kind: &Value) -> anyhow::Result<()> {
    ok(dao
        .council
        .call(dao.contract.id(), "act_proposal")
        .args_json(json!({ "id": id, "action": action, "proposal": kind }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?);
    Ok(())
}

#[tokio::test]
async fn dao_proposal_approved_funds_batch() -> anyhow::Result<()> {
    let env = setup().await?;
    let dao = dao_setup(&env).await?;
    let kind = proposal_kind(&env, &[AMT, AMT], 60, 600);
    let id = propose(&env, &dao, &kind).await?;
    assert_eq!(
        batch_count(&env).await?,
        0,
        "nothing funded before the vote"
    );
    vote(&dao, id, "VoteApprove", &kind).await?;
    assert_eq!(batch_count(&env).await?, 1);
    let b: Value = env
        .escrow
        .view("get_batch")
        .args_json(json!({ "batch_id": "0" }))
        .await?
        .json()?;
    assert_eq!(b["funder"], dao.contract.id().as_str());
    assert_eq!(b["payout_count"], 2);
    assert_eq!(
        balance(&env, dao.contract.id()).await?,
        10 * AMT - locked_total(&[AMT, AMT])
    );
    Ok(())
}

#[tokio::test]
async fn dao_proposal_rejected_funds_nothing() -> anyhow::Result<()> {
    let env = setup().await?;
    let dao = dao_setup(&env).await?;
    let kind = proposal_kind(&env, &[AMT], 60, 600);
    let id = propose(&env, &dao, &kind).await?;
    vote(&dao, id, "VoteReject", &kind).await?;
    assert_eq!(batch_count(&env).await?, 0);
    assert_eq!(balance(&env, dao.contract.id()).await?, 10 * AMT);
    Ok(())
}

#[tokio::test]
async fn refund_goes_back_to_dao() -> anyhow::Result<()> {
    let env = setup().await?;
    let dao = dao_setup(&env).await?;
    let kind = proposal_kind(&env, &[AMT], 5, 15);
    let id = propose(&env, &dao, &kind).await?;
    vote(&dao, id, "VoteApprove", &kind).await?;
    let p: Value = env
        .escrow
        .view("get_payout")
        .args_json(json!({ "batch_id": "0", "payout_id": 0 }))
        .await?
        .json()?;
    wait_past(&env, p["final_deadline_ns"].as_str().unwrap().parse()?).await?;
    ok(env
        .stranger
        .call(env.escrow.id(), "refund")
        .args_json(json!({ "batch_id": "0", "payout_id": 0 }))
        .max_gas()
        .transact()
        .await?);
    assert_eq!(balance(&env, dao.contract.id()).await?, 10 * AMT);
    Ok(())
}
