//! Sandbox setup shared by integration tests. Reads committed wasm from contracts/res.
#![allow(dead_code)]

use ed25519_dalek::{Signer, SigningKey};
use elivo_escrow::signing::*;
use near_sdk::json_types::Base64VecU8;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

pub const S: u64 = 1_000_000_000;
pub const BOND: u128 = 1_000_000_000;

pub fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}; run `make wasm`"))
}

pub fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
pub fn near_pk(k: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        bs58::encode(k.verifying_key().as_bytes()).into_string()
    )
}
pub fn b64(sig: &[u8]) -> Value {
    serde_json::to_value(Base64VecU8(sig.to_vec())).unwrap()
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub escrow: Contract,
    pub owner: Account,
    pub router: Account,
    pub funder: Account,
    pub firms: Vec<Account>, // mx1, mx2, mx3
    pub stranger: Account,
    pub oracle: SigningKey,
    pub receipt: SigningKey,
    pub firm_keys: Vec<SigningKey>,
}

pub async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

pub fn ok(r: ExecutionFinalResult) -> ExecutionFinalResult {
    assert!(r.is_success(), "tx failed: {:#?}", r.failures());
    r
}

pub async fn register_usdc(usdc: &Contract, who: &Account) -> anyhow::Result<()> {
    ok(who
        .call(usdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": who.id() }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?);
    Ok(())
}

pub async fn mint(env_usdc: &Contract, to: &Account, amount: u128) -> anyhow::Result<()> {
    ok(env_usdc
        .call("mint")
        .args_json(json!({ "account_id": to.id(), "amount": amount.to_string() }))
        .transact()
        .await?);
    Ok(())
}

pub async fn setup() -> anyhow::Result<Env> {
    setup_with_bonds(&[BOND, BOND, BOND]).await
}

pub async fn setup_with_bonds(bonds: &[u128; 3]) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let usdc_acc = sub(&root, "usdc", 20).await?;
    let usdc = ok_deploy(usdc_acc.deploy(&wasm("mock_usdc")).await?)?;
    ok(usdc
        .call("new")
        .args_json(json!({ "owner_id": usdc.id(), "total_supply": "0" }))
        .transact()
        .await?);
    let escrow_acc = sub(&root, "escrow", 20).await?;
    let escrow = ok_deploy(escrow_acc.deploy(&wasm("elivo_escrow")).await?)?;
    let owner = sub(&root, "owner", 10).await?;
    let router = sub(&root, "router", 10).await?;
    let funder = sub(&root, "funder", 10).await?;
    let stranger = sub(&root, "stranger", 10).await?;
    let mut firms = vec![];
    for n in 1..=3 {
        firms.push(sub(&root, &format!("mx{n}"), 10).await?);
    }
    let (oracle, receipt) = (key(1), key(2));
    let firm_keys: Vec<SigningKey> = (1..=3).map(|n| key(10 + n)).collect();
    ok(escrow
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(), "token_id": usdc.id(), "router_id": router.id(),
            "oracle_pk": near_pk(&oracle), "receipt_pk": near_pk(&receipt), "demo_mode": true }))
        .transact()
        .await?);
    register_usdc(&usdc, escrow.as_account()).await?;
    for a in [&owner, &router, &funder, &stranger]
        .into_iter()
        .chain(firms.iter())
    {
        register_usdc(&usdc, a).await?;
    }
    mint(&usdc, &funder, 100_000_000_000).await?;
    ok(funder
        .call(escrow.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?);
    for (i, f) in firms.iter().enumerate() {
        ok(f.call(escrow.id(), "storage_deposit")
            .args_json(json!({}))
            .deposit(NearToken::from_millinear(100))
            .transact()
            .await?);
        ok(f.call(escrow.id(), "register_firm")
            .args_json(json!({ "pk": near_pk(&firm_keys[i]) }))
            .transact()
            .await?);
        ok(owner
            .call(escrow.id(), "approve_firm")
            .args_json(json!({ "firm_id": f.id() }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?);
        mint(&usdc, f, bonds[i]).await?;
        ft_transfer_call(
            &usdc,
            f,
            escrow.id().as_str(),
            bonds[i],
            r#"{"kind":"post_bond"}"#,
        )
        .await?;
    }
    Ok(Env {
        worker,
        usdc,
        escrow,
        owner,
        router,
        funder,
        firms,
        stranger,
        oracle,
        receipt,
        firm_keys,
    })
}

fn ok_deploy(e: near_workspaces::result::Execution<Contract>) -> anyhow::Result<Contract> {
    Ok(e.into_result()?)
}

pub async fn ft_transfer_call(
    usdc: &Contract,
    from: &Account,
    to: &str,
    amount: u128,
    msg: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(ok(from
        .call(usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": to, "amount": amount.to_string(), "msg": msg }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?))
}

pub fn locked_total(amounts: &[u128]) -> u128 {
    amounts.iter().map(|a| a + a * 25 / 10_000).sum()
}

pub fn fund_msg(env: &Env, amounts: &[u128], cut_s: u64, dl_s: u64) -> String {
    let payouts: Vec<Value> = amounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            json!({ "id": i, "amount": a.to_string(),
            "cutoff_in_ns": (cut_s * S).to_string(), "deadline_in_ns": (dl_s * S).to_string() })
        })
        .collect();
    json!({ "kind": "fund_batch", "batch_hash": "cd".repeat(32), "router_id": env.router.id(),
        "oracle_pk": near_pk(&env.oracle), "payouts": payouts })
    .to_string()
}

/// Funds a batch from `env.funder`; returns the batch id.
pub async fn fund(env: &Env, amounts: &[u128], cut_s: u64, dl_s: u64) -> anyhow::Result<u64> {
    let before = batch_count(env).await?;
    ft_transfer_call(
        &env.usdc,
        &env.funder,
        env.escrow.id().as_str(),
        locked_total(amounts),
        &fund_msg(env, amounts, cut_s, dl_s),
    )
    .await?;
    let after = batch_count(env).await?;
    assert_eq!(after, before + 1, "batch was not created");
    Ok(before)
}

pub async fn batch_count(env: &Env) -> anyhow::Result<u64> {
    let v: String = env
        .escrow
        .view("get_batch_count")
        .args_json(json!({}))
        .await?
        .json()?;
    Ok(v.parse()?)
}

pub async fn balance(env: &Env, who: impl AsRef<str>) -> anyhow::Result<u128> {
    let v: String = env
        .usdc
        .view("ft_balance_of")
        .args_json(json!({ "account_id": who.as_ref() }))
        .await?
        .json()?;
    Ok(v.parse()?)
}

pub async fn payout(env: &Env, batch: u64, id: u32) -> anyhow::Result<Value> {
    Ok(env
        .escrow
        .view("get_payout")
        .args_json(json!({ "batch_id": batch.to_string(), "payout_id": id }))
        .await?
        .json()?)
}

pub async fn firm(env: &Env, n: usize) -> anyhow::Result<Value> {
    Ok(env
        .escrow
        .view("get_firm")
        .args_json(json!({ "firm_id": env.firms[n - 1].id() }))
        .await?
        .json()?)
}

pub fn escrow_id(env: &Env) -> near_sdk::AccountId {
    env.escrow.id().as_str().parse().unwrap()
}

pub fn quote_sig(env: &Env, n: usize, batch: u64, payout: u32, bps: u16) -> Value {
    let q = Quote {
        batch_id: batch,
        payout_id: payout,
        firm_id: env.firms[n - 1].id().as_str().parse().unwrap(),
        quote_bps: bps,
    };
    b64(&env.firm_keys[n - 1]
        .sign(&message(QUOTE_DOMAIN, &escrow_id(env), &q))
        .to_bytes())
}

pub fn proof(env: &Env, batch: u64, payout: u32, n: usize, at: u64, nonce: u64) -> (Value, Value) {
    let firm_id: near_sdk::AccountId = env.firms[n - 1].id().as_str().parse().unwrap();
    let p = DeliveryProof {
        batch_id: batch,
        payout_id: payout,
        firm_id: firm_id.clone(),
        delivered_at_ns: at,
        proof_ref: format!("CEP-SIM-{nonce}"),
        nonce,
    };
    let sig = b64(&env
        .oracle
        .sign(&message(PROOF_DOMAIN, &escrow_id(env), &p))
        .to_bytes());
    let j = json!({ "batch_id": batch.to_string(), "payout_id": payout, "firm_id": firm_id,
        "delivered_at_ns": at.to_string(), "proof_ref": p.proof_ref, "nonce": nonce.to_string() });
    (j, sig)
}

pub fn exclusion(
    env: &Env,
    batch: u64,
    payout: u32,
    n: usize,
    at: u64,
    nonce: u64,
) -> (Value, Value) {
    let firm_id: near_sdk::AccountId = env.firms[n - 1].id().as_str().parse().unwrap();
    let x = Exclusion {
        batch_id: batch,
        payout_id: payout,
        firm_id: firm_id.clone(),
        reason_code: REASON_ACCOUNT_CLOSED,
        observed_at_ns: at,
        nonce,
    };
    let sig = b64(&env
        .oracle
        .sign(&message(EXCLUSION_DOMAIN, &escrow_id(env), &x))
        .to_bytes());
    let j = json!({ "batch_id": batch.to_string(), "payout_id": payout, "firm_id": firm_id,
        "reason_code": REASON_ACCOUNT_CLOSED, "observed_at_ns": at.to_string(), "nonce": nonce.to_string() });
    (j, sig)
}

pub async fn router_call(
    env: &Env,
    method: &str,
    args: Value,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(env
        .router
        .call(env.escrow.id(), method)
        .args_json(args)
        .gas(Gas::from_tgas(200))
        .transact()
        .await?)
}

pub async fn assign(
    env: &Env,
    batch: u64,
    payout: u32,
    n: usize,
    bps: u16,
) -> anyhow::Result<ExecutionFinalResult> {
    router_call(env, "assign", json!({ "batch_id": batch.to_string(), "payout_id": payout,
        "firm_id": env.firms[n - 1].id(), "quote_bps": bps, "quote_sig": quote_sig(env, n, batch, payout, bps) })).await
}

pub async fn reroute(
    env: &Env,
    batch: u64,
    payout: u32,
    n: usize,
    bps: u16,
) -> anyhow::Result<ExecutionFinalResult> {
    router_call(env, "reroute", json!({ "batch_id": batch.to_string(), "payout_id": payout,
        "new_firm_id": env.firms[n - 1].id(), "quote_bps": bps, "quote_sig": quote_sig(env, n, batch, payout, bps) })).await
}

pub async fn settle(
    env: &Env,
    batch: u64,
    payout: u32,
    n: usize,
    at: u64,
    nonce: u64,
) -> anyhow::Result<ExecutionFinalResult> {
    let (p, sig) = proof(env, batch, payout, n, at, nonce);
    router_call(env, "settle", json!({ "batch_id": batch.to_string(), "payout_id": payout, "proof": p, "oracle_sig": sig })).await
}

pub async fn now_ns(env: &Env) -> anyhow::Result<u64> {
    Ok(env.worker.view_block().await?.timestamp())
}

/// Advance the sandbox until block time is strictly past `target_ns`.
pub async fn wait_past(env: &Env, target_ns: u64) -> anyhow::Result<u64> {
    loop {
        let now = now_ns(env).await?;
        if now > target_ns {
            return Ok(now);
        }
        let blocks = ((target_ns - now) / S).clamp(1, 1000) + 1;
        env.worker.fast_forward(blocks).await?;
    }
}

pub fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.failures())
}

/// Parse every NEP-297 `elivo` event in a result's logs into (event, data).
pub fn events(r: &ExecutionFinalResult) -> Vec<(String, Value)> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|v| v["standard"] == "elivo")
        .map(|v| {
            (
                v["event"].as_str().unwrap().to_string(),
                v["data"][0].clone(),
            )
        })
        .collect()
}
