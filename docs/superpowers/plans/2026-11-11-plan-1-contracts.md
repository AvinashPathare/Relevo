# Plan 1 — Contracts, Tests, CI, Testnet Deploy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `elivo-escrow` and `mock-usdc` NEAR contracts with unit, property and sandbox tests green in CI, and a script that deploys them to testnet.

**Architecture:** A pure Rust `core` module (no `env` calls) holds the state machine and money math, and proptest drives it directly. A thin `#[near]` contract wraps `core` with storage, access control, signature checks, events and token transfers. near-workspaces integration tests run the compiled wasm against a sandbox, including a real Sputnik DAO v2.3.1.

**Tech Stack:** Rust 1.95.0, near-sdk 5.30.1, near-contract-standards 5.30.1, near-workspaces 0.24.0, proptest 1.12, cargo-near 0.23, near-cli-rs 0.31, Node 22 (scripts only, no deps).

**Spec:** `docs/superpowers/specs/2026-11-11-payout-guard-design.md`. Read §4, §5 and §7 before starting.

Plan 2 (router, simulators, oracle, receipts, `make demo`) and Plan 3 (web app, Sputnik UI, 1Click) follow and consume this plan's interfaces.

## Global Constraints

- Licence: Apache-2.0, `LICENSE` committed in the first commit that adds code.
- Toolchain is pinned in `rust-toolchain.toml`: `channel = "1.95.0"`, target `wasm32-unknown-unknown`.
- Amounts are USDC base units (6 decimals) as `u128`, serialised as JSON strings (`U128`). Times are ns as `u64`, serialised as `U64` strings.
- All bps math rounds down: `x * bps / 10_000`.
- Constants: `penalty_bps_per_period = 1`, `cap_bps = 200`, `max_fee_bps = 25`, `exposure_multiple = 20`, `min_payout = 1_000_000`, `max_batch = 50`. Demo `period_ns = 10_000_000_000`; real `period_ns = 3_600_000_000_000`.
- Events: NEP-297, `standard: "elivo"`, `version: "1.0.0"`, logged as `EVENT_JSON:{...}`. They carry only ids, amounts, hashes and account ids, never names or CLABEs.
- No method may send escrowed tokens anywhere except the payout's current firm (after a valid proof) or the batch funder.
- Every invalid `ft_on_transfer` panics, so NEP-141 `ft_resolve_transfer` returns the full amount and all state rolls back.
- Signed messages: `borsh((domain: String, escrow_id: AccountId, payload))`, with domains `"elivo-quote-v1"`, `"elivo-proof-v1"` and `"elivo-exclusion-v1"`.
- Public repo hygiene: no keys, no `.env`, no business documents. `.data/` and `.cache/` are gitignored.
- Label text (README and any UI): "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited."

## Review Focus

1. **Fee rounding.** For an odd amount such as `1_000_001`, `locked` is `1_000_001 + 2_500 = 1_003_501`. A funder whose total is off by one base unit gets a full refund, not a partial batch. Pinned in Task 2 (`locked_rounds_down`) and Task 6 (`fund_wrong_total_refunds`).
2. **Reroute exactly at the cut-off.** `now == cutoff` is not late; reroute needs `now > cutoff`. Pinned in Task 3 (`reroute_at_exact_cutoff_rejected`).
3. **Proof dated in the future.** `delivered_at_ns > now` is rejected, so a firm can't pre-date itself "on time" or post-date anything. Pinned in Task 3 (`settle_future_delivery_rejected`).
4. **Bond drained to zero.** The penalty is capped by the remaining bond, and a firm with a zero bond can't be assigned anything. Pinned in Task 3 (`penalty_capped_by_bond_then_firm_unassignable`).
5. **Unparseable or unknown `msg`** on `ft_on_transfer`: the full amount comes back. Pinned in Task 6 (`ft_on_transfer_garbage_msg_refunds`).

---

### Task 1: Repo scaffold, mock USDC, CI

**Files:**
- Create: `LICENSE` (Apache-2.0 full text), `rust-toolchain.toml`, `Cargo.toml` (workspace: `contracts/escrow`, `contracts/mock-usdc`), `Makefile`, `.github/workflows/ci.yml`, `README.md` (stub: name, label text, "work in progress")
- Create: `contracts/mock-usdc/Cargo.toml`, `contracts/mock-usdc/src/lib.rs`
- Create: `contracts/res/.gitkeep`

**Interfaces:**
- Produces: the mock USDC contract.
  - `new(owner_id: AccountId, total_supply: U128)`
  - NEP-141 core plus storage management, from `near_contract_standards::fungible_token`
  - `mint(account_id: AccountId, amount: U128)`, owner only, account must be registered
  - metadata `{ spec: "ft-1.0.0", name: "Mock USDC (testnet)", symbol: "mUSDC", decimals: 6 }`
- Produces: `make wasm`, which builds both contracts with `cargo near build non-reproducible-wasm` (adjust flags to the installed cargo-near if needed) and copies them to `contracts/res/elivo_escrow.wasm` and `contracts/res/mock_usdc.wasm`.
- Produces: `make test-contracts`, which runs `make wasm`, then `cargo test --workspace`.

- [ ] **Step 1: Write the failing test** in `contracts/mock-usdc/src/lib.rs` (`#[cfg(test)]`, near-sdk unit test env).
  - `mint_by_owner_increases_balance`: after `mint(alice, 5_000_000)`, `ft_balance_of(alice) == 5_000_000`.
  - `mint_by_non_owner_panics`: `#[should_panic(expected = "owner only")]`.
- [ ] **Step 2: Run** `cargo test -p mock-usdc`. Expected: FAIL (does not compile).
- [ ] **Step 3: Implement** `mock-usdc` with `FungibleToken` and `#[near(contract_state)]`. The `new` constructor registers the owner and mints `total_supply` to them.
- [ ] **Step 4: Run** `cargo test -p mock-usdc` and `make wasm`. Expected: PASS, and `contracts/res/mock_usdc.wasm` exists. The escrow crate can be an empty `#[near]` stub for now so the workspace builds.
- [ ] **Step 5: CI.** `.github/workflows/ci.yml` runs on push and pull_request on `ubuntu-latest`:
  - checkout
  - `dtolnay/rust-toolchain@1.95.0` with target `wasm32-unknown-unknown` and components `clippy, rustfmt`
  - `Swatinem/rust-cache@v2`
  - install cargo-near with its installer script
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `make test-contracts`

  Add a CI badge line to `README.md` (repo slug placeholder `OWNER/elivo-payout-guard` until the repo exists).
- [ ] **Step 6: Commit.** `git add -A && git commit -m "chore: workspace, licence, CI, mock USDC"`

### Task 2: Escrow core — types and money math

**Files:**
- Create: `contracts/escrow/src/core/mod.rs`, `contracts/escrow/src/core/types.rs`, `contracts/escrow/src/core/math.rs`
- Test: inline `#[cfg(test)] mod tests` in `math.rs`

**Interfaces:**
- Produces, in `core::types`. All derive `Clone, Debug, PartialEq`; storage types also derive borsh via `#[near(serializers=[borsh])]`:
  ```rust
  pub struct Params { pub period_ns: u64, pub penalty_bps_per_period: u16, pub cap_bps: u16,
      pub max_fee_bps: u16, pub exposure_multiple: u32, pub reroute_window_ns: u64,
      pub min_payout: u128, pub max_batch: u32 }
  pub enum PayoutState { Funded, Assigned, Delivered, Refunded }
  pub struct Payout { pub amount: u128, pub locked: u128, pub state: PayoutState,
      pub firm: Option<AccountId>, pub quote_bps: u16, pub cutoff_ns: u64,
      pub final_deadline_ns: u64, pub penalties_total: u128, pub firms_tried: Vec<AccountId>,
      pub excluded: bool, pub delivered_at_ns: Option<u64>, pub proof_ref: Option<String> }
  pub struct Firm { pub pk: [u8; 32], pub approved: bool, pub bond: u128, pub open_exposure: u128,
      pub delivered_on_time: u32, pub delivered_late: u32, pub penalties_paid: u128, pub volume: u128 }
  pub struct PayoutIn { pub id: u32, pub amount: u128, pub cutoff_in_ns: u64, pub deadline_in_ns: u64 }
  pub struct Outcome { pub pay_firm: u128, pub pay_funder: u128, pub penalty: u128, pub periods: u64 }
  pub enum CoreError { EmptyBatch, BatchTooLarge, BadPayoutId, BelowMinPayout, BadTiming,
      TotalMismatch, WrongState, FirmNotApproved, QuoteTooHigh, ExposureExceeded, CutoffPassed,
      NotLate, FirmAlreadyTried, WrongFirm, DeliveredInFuture, NotRefundableYet, BondTooLow }
  ```
  `CoreError` implements `Display`, producing snake_case messages (`"exposure_exceeded"`). Contract panics and integration-test assertions use these strings.
- Produces, in `core::math`:
  - `pub fn fee_for(amount: u128, bps: u16) -> u128`
  - `pub fn locked_for(p: &Params, amount: u128) -> u128` = `amount + fee_for(amount, p.max_fee_bps)`
  - `pub fn periods_late(p: &Params, t: u64, cutoff: u64) -> u64` = `0` if `t <= cutoff`, else `max(1, ceil((t - cutoff) / period_ns))`
  - `pub fn penalty_for(p: &Params, amount: u128, periods: u64, penalties_total: u128, bond: u128) -> u128` = `min(amount × min(periods, cap/rate) × rate / 10_000, cap_amount − penalties_total, bond)`, where `cap_amount = fee_for(amount, cap_bps)`. Uses saturating arithmetic and never panics.
  - `pub fn demo_params() -> Params` and `pub fn real_params() -> Params`, with the Global Constraints values. `reroute_window_ns` is `30_000_000_000` for demo and `3_600_000_000_000` for real.

- [ ] **Step 1: Write the failing tests** in `math.rs`:
  - `locked_rounds_down`: `locked_for(&demo_params(), 1_000_001) == 1_003_501`
  - `periods_not_late`: `periods_late(p, 100, 100) == 0`
  - `periods_min_one`: `periods_late(p, cutoff + 1, cutoff) == 1`
  - `periods_ceil`: with demo period, `periods_late(p, cutoff + 10_000_000_001, cutoff) == 2`
  - `penalty_24_periods_on_10k`: `penalty_for(p, 10_000_000_000, 24, 0, u128::MAX) == 24_000_000` ($24 on $10,000)
  - `penalty_caps_at_2pct`: `penalty_for(p, 10_000_000_000, 500, 0, u128::MAX) == 200_000_000`
  - `penalty_respects_prior_penalties`: `penalty_for(p, 10_000_000_000, 500, 150_000_000, u128::MAX) == 50_000_000`
  - `penalty_capped_by_bond`: `penalty_for(p, 10_000_000_000, 24, 0, 5) == 5`
- [ ] **Step 2: Run** `cargo test -p elivo-escrow core::math`. Expected: FAIL (does not compile).
- [ ] **Step 3: Implement** `types.rs` and `math.rs` exactly as listed under Interfaces.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(escrow): core types and penalty math"`

### Task 3: Escrow core — state transitions

**Files:**
- Create: `contracts/escrow/src/core/engine.rs`
- Test: inline tests in `engine.rs`

**Interfaces:**
- Consumes: Task 2 types and math.
- Produces. All are pure functions and mutate only their arguments. On `Err`, nothing is mutated: validate first, then mutate.
  - `pub fn new_payouts(p: &Params, items: &[PayoutIn], transferred: u128, now: u64) -> Result<Vec<Payout>, CoreError>`
    - Errors: `EmptyBatch` when empty; `BatchTooLarge` when there are more than `max_batch` items; `BadPayoutId` unless `items[i].id == i`; `BelowMinPayout`; `BadTiming` unless `0 < cutoff_in < deadline_in`; `TotalMismatch` unless `Σ locked_for == transferred`.
    - Each payout starts `Funded` with `cutoff_ns = now + cutoff_in` and `final_deadline_ns = now + deadline_in`.
  - `pub fn post_bond(firm: &mut Firm, amount: u128)`
  - `pub fn assign(p: &Params, payout: &mut Payout, firm_id: &AccountId, firm: &mut Firm, quote_bps: u16, now: u64) -> Result<(), CoreError>`
    - Requires `state == Funded` (`WrongState`), `now < cutoff_ns` (`CutoffPassed`), `firm.approved` (`FirmNotApproved`) and `quote_bps <= max_fee_bps` (`QuoteTooHigh`).
    - Requires `firm.open_exposure + amount <= firm.bond * exposure_multiple` (`ExposureExceeded`).
    - Effects: state becomes `Assigned`; `firm` and `quote_bps` are set; `firm_id` is pushed to `firms_tried`; exposure grows by `amount`.
  - `pub fn reroute(p: &Params, payout: &mut Payout, old: &mut Firm, new_id: &AccountId, new: &mut Firm, quote_bps: u16, now: u64) -> Result<Outcome, CoreError>`
    - Requires `state == Assigned`, `now > cutoff_ns` (`NotLate`), `now < final_deadline_ns` (`CutoffPassed`), `!excluded` (`WrongState`) and `new_id` not in `firms_tried` (`FirmAlreadyTried`), plus the `assign` checks on `new`.
    - Effects: the penalty is computed with `t = now` and debited from `old.bond`, added to `old.penalties_paid` and `payout.penalties_total`; `old` exposure drops by `amount`; the payout moves to `new` with `cutoff_ns = min(now + reroute_window_ns, final_deadline_ns)`.
    - Returns `Outcome { pay_funder: penalty, penalty, periods, pay_firm: 0 }`.
  - `pub fn settle(p: &Params, payout: &mut Payout, firm_id: &AccountId, firm: &mut Firm, delivered_at: u64, proof_ref: String, now: u64) -> Result<Outcome, CoreError>`
    - Requires `state == Assigned`, `payout.firm == Some(firm_id)` (`WrongFirm`), `!excluded` and `delivered_at <= now` (`DeliveredInFuture`).
    - Effects: penalty uses `t = delivered_at`; state becomes `Delivered`; exposure is released; `delivered_on_time` or `delivered_late` is incremented; `volume += amount`.
    - Returns `pay_firm = amount + fee_for(amount, quote_bps)` and `pay_funder = (locked − pay_firm) + penalty`.
  - `pub fn exclude(payout: &mut Payout, firm_id: &AccountId, firm: &mut Firm) -> Result<(), CoreError>`
    - Requires `state == Assigned`, `!excluded` and `payout.firm == Some(firm_id)`.
    - Effects: `excluded = true`; exposure is released; `payout.firm` is kept for the record.
  - `pub fn refund(p: &Params, payout: &mut Payout, firm: Option<&mut Firm>, now: u64) -> Result<Outcome, CoreError>`
    - Requires `state ∈ {Funded, Assigned}` and either `excluded` or `now > final_deadline_ns` (`NotRefundableYet`).
    - If the payout is `Assigned` and not excluded, `firm` must be `Some`: charge a penalty with `t = now` and release exposure.
    - Effects: state becomes `Refunded`. Returns `pay_funder = locked + penalty`.
  - `pub fn withdraw_bond(p: &Params, firm: &mut Firm, amount: u128) -> Result<(), CoreError>`
    - Requires `amount <= bond` and `(bond − amount) * exposure_multiple >= open_exposure` (`BondTooLow`).

- [ ] **Step 1: Write the failing tests** in `engine.rs`, one per rule above. Required names:
  - `new_payouts_happy`, `new_payouts_rejects_empty`, `new_payouts_rejects_51`, `new_payouts_rejects_bad_ids`, `new_payouts_rejects_total_off_by_one`, `new_payouts_rejects_bad_timing`, `new_payouts_rejects_below_min`
  - `assign_happy_sets_exposure`, `assign_rejects_unapproved`, `assign_rejects_quote_26bps`, `assign_rejects_over_exposure` (bond 1_000_000, payout 20_000_001), `assign_rejects_after_cutoff`, `assign_rejects_wrong_state`
  - `reroute_charges_late_firm` (amount 10_000_000_000, 3 periods late, so penalty 3_000_000; new cut-off is `now + 30s`), `reroute_at_exact_cutoff_rejected`, `reroute_rejects_tried_firm`, `reroute_rejects_excluded`, `reroute_twice_respects_cap_total`
  - `settle_on_time_pays_fee_and_returns_leftover` (amount 1_000_000_000 at 20 bps: `pay_firm 1_002_000_000`, `pay_funder 500_000`), `settle_late_charges_penalty`, `settle_wrong_firm_rejected`, `settle_future_delivery_rejected`, `settle_twice_rejected`
  - `exclude_releases_exposure_no_penalty`, `exclude_wrong_firm_rejected`
  - `refund_before_deadline_rejected`, `refund_after_deadline_funded`, `refund_after_deadline_assigned_charges_firm`, `refund_excluded_immediately_no_penalty`, `refund_twice_rejected`
  - `withdraw_bond_respects_exposure`, `penalty_capped_by_bond_then_firm_unassignable`
- [ ] **Step 2: Run** `cargo test -p elivo-escrow core::engine`. Expected: FAIL.
- [ ] **Step 3: Implement** `engine.rs` to these signatures.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(escrow): core state machine"`

### Task 4: Property tests — the five invariants

**Files:**
- Create: `contracts/escrow/tests/core_props.rs`. Uses the crate's `core` module, so `core` must be `pub` in `lib.rs`.

**Interfaces:**
- Consumes: Task 3 engine functions.
- Produces: an in-test `Model` holding batches, firms, `funder_received`, `firm_received`, `owner_received`, `escrow_balance` and `bonds`. It applies a random `Vec<Op>` with `Op ∈ { Fund, PostBond, Assign, Reroute, Settle, Exclude, Refund, WithdrawBond, AdvanceTime(ns) }`. Ops that return `Err` must leave the model unchanged.

- [ ] **Step 1: Write the property tests.** Use `proptest! { #![proptest_config(ProptestConfig::with_cases(512))] ... }` with three firms, up to 3 batches of up to 5 payouts, and up to 60 ops.
  - `inv1_escrow_balance`: `escrow_balance == Σ locked(non-terminal) + Σ bond`
  - `inv2_single_terminal_payout`: each payout is paid at most once; terminal states never change
  - `inv3_penalty_bounds`: `penalties_total <= fee_for(amount, 200)` for every payout, and no bond underflows (checked arithmetic in the model panics on underflow)
  - `inv4_penalties_to_funder`: `owner_received == 0`, and total penalties charged equals the penalty share of `funder_received`
  - `inv5_no_arbitrary_destination`: every transfer is to the current firm (`Settle`) or the funder

  Claims are contract-level (Task 7), so they are not modelled here.
- [ ] **Step 2: Run** `cargo test -p elivo-escrow --test core_props`. Expected: PASS. If it fails, fix `engine.rs`, not the property.
- [ ] **Step 3: Commit.** `git commit -am "test(escrow): property tests for invariants"`

### Task 5: Signed messages and cross-language vectors

**Files:**
- Create: `contracts/escrow/src/signing.rs`, `contracts/escrow/tests/fixtures/signing-vectors.json`
- Test: inline tests in `signing.rs`. Add `ed25519-dalek` (2.x, feature `rand_core`) as a dev-dependency.

**Interfaces:**
- Produces, all borsh-serialised in this exact field order:
  ```rust
  pub struct Quote { pub batch_id: u64, pub payout_id: u32, pub firm_id: AccountId, pub quote_bps: u16 }
  pub struct DeliveryProof { pub batch_id: u64, pub payout_id: u32, pub firm_id: AccountId,
      pub delivered_at_ns: u64, pub proof_ref: String, pub nonce: u64 }   // also JSON (U64 for u64 fields)
  pub struct Exclusion { pub batch_id: u64, pub payout_id: u32, pub firm_id: AccountId,
      pub reason_code: u8, pub observed_at_ns: u64, pub nonce: u64 }      // reason 1 = ACCOUNT_CLOSED
  pub fn message<T: BorshSerialize>(domain: &str, escrow: &AccountId, payload: &T) -> Vec<u8>
  pub fn verify(pk: &[u8; 32], msg: &[u8], sig: &[u8]) -> bool   // false if sig.len() != 64; uses env::ed25519_verify
  pub const QUOTE_DOMAIN: &str = "elivo-quote-v1"; // likewise PROOF_DOMAIN, EXCLUSION_DOMAIN
  ```
- Produces `signing-vectors.json`, which Plan 2's TypeScript signer must reproduce byte for byte:
  `[{ "domain", "escrow_id", "payload": {...}, "message_hex", "seed_hex", "public_key_b58", "signature_hex" }]`
  It has one entry each for quote, proof and exclusion. The seed is 32 bytes of `0x07`; `escrow_id = "escrow.test.near"`.

- [ ] **Step 1: Write the failing tests:**
  - `message_matches_vectors`: for each vector, `hex(message(...)) == message_hex`
  - `verify_accepts_vector_signature`
  - `verify_rejects_flipped_byte`
  - `verify_rejects_short_sig`
  - `domains_differ`: the same payload under quote and proof domains gives different messages
- [ ] **Step 2: Run** `cargo test -p elivo-escrow signing`. Expected: FAIL.
- [ ] **Step 3: Implement** `signing.rs`. Generate the fixture once with an `#[ignore]` test `write_vectors`, which uses ed25519-dalek to sign and writes the file. Commit the file; the other tests read it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(escrow): domain-separated signed messages + vectors"`

### Task 6: Contract — config, storage credit, firms, funding, events, views

**Files:**
- Create: `contracts/escrow/src/lib.rs` (contract state and init), `contracts/escrow/src/events.rs`, `contracts/escrow/src/views.rs`, `contracts/escrow/src/funding.rs` (`ft_on_transfer`), `contracts/escrow/src/firms.rs`, `contracts/escrow/src/storage.rs`
- Test: `contracts/escrow/src/tests/mod.rs` (near-sdk `VMContextBuilder` unit tests)

**Interfaces:**
- Consumes: `core::*`, `signing::*`.
- Produces the contract state:
  ```rust
  pub struct Escrow { owner_id: AccountId, token_id: AccountId, router_id: AccountId,
      oracle_pk: [u8;32], receipt_pk: [u8;32], params: Params, paused: bool,
      batches: LookupMap<u64, Batch>, payouts: LookupMap<(u64,u32), Payout>,
      firms: IterableMap<AccountId, Firm>, used_nonces: LookupSet<u64>,
      claimable: LookupMap<AccountId, u128>, storage_credit: LookupMap<AccountId, u128>,
      next_batch_id: u64 }
  pub struct Batch { id: u64, funder: AccountId, batch_hash: [u8;32], funded_at_ns: u64,
      payout_count: u32, router_id: AccountId, oracle_pk: [u8;32], receipt_pk: [u8;32],
      receipt_hash: Option<[u8;32]> }
  ```
- Produces the contract methods, JSON interface:
  - `#[init] new(owner_id, token_id, router_id, oracle_pk: PublicKey, receipt_pk: PublicKey, demo_mode: bool)`. Uses `demo_params()` if `demo_mode`, else `real_params()`. Rejects non-ed25519 keys.
  - `set_router(router_id)`, `set_oracle_pk(pk)`, `set_receipt_pk(pk)`, `set_paused(paused: bool)`: owner only, 1 yocto. They affect new batches only, because batches snapshot keys at funding.
  - `#[payable] storage_deposit(account_id: Option<AccountId>)`, which credits the attached NEAR. `storage_balance_of(account_id) -> U128`.
  - `register_firm(pk: PublicKey)` charges storage to the caller's credit. `approve_firm(firm_id)` and `revoke_firm(firm_id)` are owner only.
  - `ft_on_transfer(sender_id, amount: U128, msg: String) -> PromiseOrValue<U128>`:
    - Requires `predecessor == token_id`, else panic.
    - `msg` is JSON with `kind`:
      - `"fund_batch"` with `{ batch_hash: hex64, payouts: [{ id, amount: U128, cutoff_in_ns: U64, deadline_in_ns: U64 }] }`. Panics if paused. On success returns `0`, charges the storage delta to `sender_id`'s credit (panic `"insufficient_storage_credit"` if short) and snapshots `router_id`, `oracle_pk` and `receipt_pk`.
      - `"post_bond"`: the sender must be a registered firm.
    - Any parse error or unknown kind panics.
  - Views:
    - `get_config() -> ConfigView`, with all fields; keys as `"ed25519:<b58>"`; params as strings
    - `get_batch(batch_id: U64) -> Option<BatchView>`
    - `get_payout(batch_id: U64, payout_id: u32) -> Option<PayoutView>`
    - `get_batch_payouts(batch_id: U64) -> Vec<PayoutView>`
    - `get_firm(firm_id) -> Option<FirmView>`
    - `list_firms() -> Vec<(AccountId, FirmView)>`
    - `get_claimable(account_id) -> U128`
    - `get_batch_count() -> U64`

    `PayoutView` mirrors `Payout`: state as a string `"Funded" | "Assigned" | "Delivered" | "Refunded"`, plus `id`, `batch_id` and `excluded`.
- Produces the event names and data. Plan 2 parses these; every number is a string.
  - `batch_funded {batch_id, funder, batch_hash, payout_count, total_locked}`
  - `firm_registered {firm_id}`
  - `firm_approved {firm_id, approved}`
  - `bond_posted {firm_id, amount, bond}`
  - `payout_assigned {batch_id, payout_id, firm_id, quote_bps, cutoff_ns}`
  - `payout_rerouted {batch_id, payout_id, from_firm, to_firm, quote_bps, cutoff_ns}`
  - `penalty_charged {batch_id, payout_id, firm_id, periods, amount, to}`
  - `payout_delivered {batch_id, payout_id, firm_id, delivered_at_ns, on_time, paid_to_firm, fee_returned, proof_ref}`
  - `payout_excluded {batch_id, payout_id, firm_id, reason_code}`
  - `payout_refunded {batch_id, payout_id, amount, to}`
  - `receipt_anchored {batch_id, receipt_hash}`
  - `transfer_failed {account_id, amount}`
  - `claimed {account_id, amount}`

- [ ] **Step 1: Write the failing unit tests:**
  - `init_rejects_secp_key`
  - `only_token_can_call_ft_on_transfer`
  - `fund_batch_happy_emits_event`
  - `fund_wrong_total_refunds` (should_panic `"total_mismatch"`)
  - `ft_on_transfer_garbage_msg_refunds` (should_panic)
  - `fund_without_storage_credit_panics`
  - `fund_while_paused_panics`
  - `batch_snapshots_keys` (`set_oracle_pk` after funding leaves `get_batch().oracle_pk` unchanged)
  - `post_bond_requires_registered_firm`
  - `approve_firm_owner_only`
  - `views_return_strings_for_numbers`
- [ ] **Step 2: Run** `cargo test -p elivo-escrow tests::`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces. `events::emit(event: &str, data: serde_json::Value)` writes the NEP-297 log.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(escrow): config, storage credit, firms, funding, views, events"`

### Task 7: Contract — router methods, refund, transfers, claims, anchor

**Files:**
- Create: `contracts/escrow/src/router.rs`, `contracts/escrow/src/payouts.rs` (refund, claim, withdraw_bond), `contracts/escrow/src/transfers.rs`
- Test: extend `contracts/escrow/src/tests/mod.rs`

**Interfaces:**
- Consumes: Task 6 state, Task 3 engine, Task 5 signing.
- Produces:
  - `assign(batch_id: U64, payout_id: u32, firm_id, quote_bps: u16, quote_sig: Base64VecU8)` and `reroute(batch_id, payout_id, new_firm_id, quote_bps, quote_sig)`
    - Caller must be `batch.router_id` (`"router_only"`). Not allowed while paused (`"paused"`).
    - `quote_sig` is verified against `firms[firm].pk` over `message(QUOTE_DOMAIN, current_account_id, Quote{..})` (`"bad_quote_sig"`).
  - `settle(batch_id, payout_id, proof: DeliveryProof, oracle_sig: Base64VecU8)`
    - Caller is the router.
    - The proof's ids must match the arguments (`"proof_mismatch"`). The nonce must be unused (`"nonce_used"`), and is inserted on success.
    - The signature is verified against `batch.oracle_pk` (`"bad_oracle_sig"`). Works while paused.
  - `exclude(batch_id, payout_id, exclusion: Exclusion, oracle_sig: Base64VecU8)`
    - Same checks as `settle`, with `reason_code == 1` (`"bad_reason"`). Works while paused.
  - `refund(batch_id, payout_id)`: anyone may call it, and it works while paused.
  - `anchor_receipt(batch_id, receipt_hash: Base58CryptoHash)`: router only, once per batch (`"already_anchored"`), all payouts terminal (`"batch_open"`).
  - `withdraw_bond(amount: U128)`: caller is the firm.
  - `claim()`
  - `transfers::send(receiver: AccountId, amount: u128) -> Promise`
    - Calls `ft_transfer` on `token_id` with 1 yocto and 15 Tgas, then `.then(on_transfer_done(receiver, amount))` with 10 Tgas.
    - `#[private] on_transfer_done`: on failure, `claimable[receiver] += amount` and emits `transfer_failed`.
    - State is always written before `send` is called.

- [ ] **Step 1: Write the failing unit tests:**
  - `assign_router_only`
  - `assign_bad_quote_sig_rejected`
  - `assign_unapproved_firm_rejected`
  - `settle_bad_oracle_sig_rejected`
  - `settle_reused_nonce_rejected`
  - `settle_proof_for_other_payout_rejected`
  - `settle_by_previous_firm_after_reroute_rejected`
  - `exclude_bad_reason_rejected`
  - `refund_by_stranger_after_deadline_ok`
  - `refund_before_deadline_rejected`
  - `paused_blocks_assign_and_reroute_not_settle_refund`
  - `failed_transfer_credits_claimable` (mock the promise result as failed with `testing_env!` and `PromiseResult::Failed`)
  - `anchor_receipt_once_and_only_when_closed`
  - `owner_cannot_move_escrow` (no owner method changes balances: call every owner method, then assert payout and claimable are unchanged)

  Sign with ed25519-dalek using the Task 5 helpers.
- [ ] **Step 2: Run** `cargo test -p elivo-escrow tests::`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run** `cargo test -p elivo-escrow` and `cargo clippy --workspace --all-targets -- -D warnings`. Expected: PASS, with no warnings.
- [ ] **Step 5: Commit.** `git commit -am "feat(escrow): router methods, refunds, claims, receipt anchor"`

### Task 8: Sandbox integration tests

**Files:**
- Create: `contracts/escrow/tests/common/mod.rs` (setup helpers), `contracts/escrow/tests/scenarios.rs`
- Modify: `Makefile`, so `test-contracts` runs `make wasm` before `cargo test`

**Interfaces:**
- Consumes: `contracts/res/*.wasm`, read with `std::fs::read` relative to `CARGO_MANIFEST_DIR`, and Task 5 signing helpers (dev-dep `ed25519-dalek`).
- Produces `common::setup() -> Env`. `Env` holds:
  - `worker`
  - the contracts `usdc` and `escrow` (escrow init with `demo_mode = true`)
  - accounts `owner`, `router`, `funder`, `mx1`, `mx2`, `mx3` and `stranger`
  - the oracle and receipt `SigningKey`s

  All accounts are storage-registered on USDC. The firms are registered, approved and bonded with 1_000_000_000 each, and the funder is minted 100_000_000_000 with escrow storage credit.

  Helpers:
  - `fund(env, amounts: &[u128], cutoff_in_s, deadline_in_s) -> u64` (batch id)
  - `quote_sig(firm_key, ...)`
  - `proof(env, ...)`
  - `fast_forward(env, blocks)`, which uses `worker.fast_forward` to move block time past cut-offs

- [ ] **Step 1: Write the scenarios:**
  - `happy_path`: fund 2 payouts → assign → settle on time. Firm balance rises by amount + fee, the funder gets the leftover fee, and escrow holds only the bonds.
  - `late_with_reroute`: assign to mx3, fast-forward past the cut-off, reroute to mx2. The `penalty_charged` event shows the funder credited, and mx3's bond drops by the same amount. mx2 settles, and a late settle from mx3 is rejected.
  - `refund_after_deadline`: the stranger calls refund, and the funder receives `locked` plus the penalty.
  - `exclusion_refund`: assign, exclude (`reason 1`), refund at once. No penalty, and the funder receives `locked`.
  - `bond_exhaustion`: mx3 with a 1_000_000 bond is rerouted at the cap until the bond is 0. The next assign to mx3 fails with `exposure_exceeded`.
  - `paused_contract`: pause, then fund fails (tokens back to the funder) and assign fails, while settle and refund succeed.
  - `double_settlement_after_reroute`: two valid proofs (old firm, new firm). Only the current firm's settles; the payout is paid once.
  - `wrong_token_refunded`: a second mock-usdc contract `ft_transfer_call`s to escrow. The sender's balance is unchanged and no batch is created.
  - `events_contain_no_pii`: across a full run, every log is parsed as NEP-297 and its `data` keys are a subset of the documented event fields.
- [ ] **Step 2: Run** `make test-contracts`. Expected: all scenarios PASS. The first run downloads the sandbox binary.
- [ ] **Step 3: Commit.** `git commit -am "test(escrow): sandbox integration scenarios"`

### Task 9: Sputnik DAO funding in the sandbox

**Files:**
- Create: `scripts/fetch-sputnik.mjs` (Node 22, no deps), `contracts/escrow/tests/sputnik.rs`
- Modify: `Makefile`. `make test-contracts` depends on `.cache/sputnikdao2.wasm`, created by `node scripts/fetch-sputnik.mjs`. CI adds the step too.

**Interfaces:**
- `fetch-sputnik.mjs`:
  - Calls testnet RPC `call_function` on `sputnikv2.testnet` → `get_code({"code_hash":"AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH"})`.
  - Checks `base58(sha256(bytes)) === "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH"`, then writes `.cache/sputnikdao2.wasm`.
  - Exits 0 with no work if the file already exists with the right hash.
  - Produces `--print-source`, which prints the source note: factory `sputnikv2.testnet`, code hash, upstream `github.com/near-daos/sputnik-dao-contract`.
- Consumes: Task 8 `common::setup()`.
- DAO setup in the test:
  - Deploy to `dao.<root>` and call `new({ config: { name: "elivo-test", purpose: "test", metadata: "" }, policy: [council_id] })`.
  - Mint USDC to the DAO, and storage-register the DAO on USDC.
  - `storage_deposit` the DAO's credit on escrow.

- [ ] **Step 1: Write the tests:**
  - `dao_proposal_approved_funds_batch`
    - The council calls `add_proposal` with deposit `get_policy().proposal_bond`. The kind is `FunctionCall { receiver_id: usdc, actions: [{ method_name: "ft_transfer_call", args: base64(json{receiver_id: escrow, amount, msg}), deposit: "1", gas: "150000000000000" }] }`.
    - The council then calls `act_proposal({ id, action: "VoteApprove", proposal: <same kind> })` with 300 Tgas.
    - Expect `get_batch(0).funder == dao` and `get_batch_count() == 1`.
  - `dao_proposal_rejected_funds_nothing`: `VoteReject`. The batch count stays 0 and the DAO's USDC is unchanged.
  - `refund_goes_back_to_dao`: approve, fast-forward past the deadline, then the stranger calls refund. The DAO's balance is restored.
- [ ] **Step 2: Run** `node scripts/fetch-sputnik.mjs && make test-contracts`. Expected: PASS. If `act_proposal` rejects the `proposal` field, check the v2.3.1 ABI (`contract_source_metadata` / errors) and adapt; record what worked in a comment.
- [ ] **Step 3: Commit.** `git commit -am "test: Sputnik DAO v2 funding flow in sandbox"`

### Task 10: Testnet deploy script

**Files:**
- Create: `scripts/gen-keys.mjs` (Node 22, `node:crypto` ed25519, no deps), `scripts/deploy-testnet.sh`, `deployments/.gitkeep`
- Modify: `Makefile` (`deploy-testnet` target)

**Interfaces:**
- `gen-keys.mjs <name>...` writes `.data/keys/<name>.json` as `{ "public_key": "ed25519:<b58>", "secret_key": "ed25519:<b58 of 64-byte seed‖pub>" }`, using NEAR's key format, and skips names that already exist. Plan 2 reads `oracle`, `receipt`, `mx1`, `mx2` and `mx3` from here.
- `deploy-testnet.sh`, using near-cli-rs non-interactively:
  - Creates `pg-<unix-ts>.testnet` with `sponsor-by-faucet-service`, keys in the legacy keychain `~/.near-credentials`.
  - Creates the subaccounts `usdc`, `escrow`, `router`, `mx1`, `mx2`, `mx3` and `council`, funded from the root. If the root runs short, it creates another faucet account and transfers from it.
  - Deploys `contracts/res/mock_usdc.wasm` and `elivo_escrow.wasm`, and calls `new` with `demo_mode=true` and keys from `gen-keys`.
  - Storage-registers everyone, registers, approves and bonds the three firms, and adds a function-call access key on `router` limited to the escrow and the methods `assign,reroute,settle,exclude,anchor_receipt,refund`.
  - Writes `deployments/testnet.json`: `{ network, root, usdc, escrow, router, firms: {mx1,mx2,mx3}, council, created_at }`. Account ids only, no keys.

- [ ] **Step 1: Run** `node scripts/gen-keys.mjs oracle receipt mx1 mx2 mx3` and check the five files are written with `ed25519:` prefixes.
- [ ] **Step 2: Run** `make deploy-testnet`. Expected: it ends by printing explorer links (`https://testnet.nearblocks.io/address/<id>`), and `near contract call-function as-read-only <escrow> get_config json-args {} network-config testnet now` returns the config.
- [ ] **Step 3: Commit.** `git add scripts deployments Makefile && git commit -m "feat: testnet deploy script + first deployment"`. `deployments/testnet.json` is committed; `.data/` is not.
