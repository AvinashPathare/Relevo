//! Elivo Payout Guard escrow: payout escrow, firm bond vault and receipt registry in one
//! contract. Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.

use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, CurveType, PanicOnDefault,
    PublicKey,
};

pub mod events;
mod firms;
mod funding;
pub mod logic;
mod payouts;
mod router;
pub mod signing;
mod storage;
mod transfers;
pub mod views;

use logic::math::{demo_params, real_params};
use logic::types::{Firm, Params, Payout};

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Batch {
    pub id: u64,
    pub funder: AccountId,
    pub batch_hash: [u8; 32],
    pub funded_at_ns: u64,
    pub payout_count: u32,
    pub router_id: AccountId,
    pub oracle_pk: [u8; 32],
    pub receipt_pk: [u8; 32],
    pub receipt_hash: Option<[u8; 32]>,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Batches,
    Payouts,
    Firms,
    Nonces,
    Claimable,
    StorageCredit,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    owner_id: AccountId,
    token_id: AccountId,
    router_id: AccountId,
    oracle_pk: [u8; 32],
    receipt_pk: [u8; 32],
    params: Params,
    paused: bool,
    batches: LookupMap<u64, Batch>,
    payouts: LookupMap<(u64, u32), Payout>,
    firms: IterableMap<AccountId, Firm>,
    used_nonces: LookupSet<u64>,
    claimable: LookupMap<AccountId, u128>,
    storage_credit: LookupMap<AccountId, u128>,
    next_batch_id: u64,
}

pub(crate) fn ed25519_bytes(pk: &PublicKey) -> [u8; 32] {
    require!(
        pk.curve_type() == CurveType::ED25519,
        "ed25519 key required"
    );
    pk.as_bytes()[1..].try_into().expect("ed25519 key required")
}

pub(crate) fn pk_string(bytes: &[u8; 32]) -> String {
    let pk = PublicKey::from_parts(CurveType::ED25519, bytes.to_vec()).expect("pk");
    String::from(&pk)
}

#[near]
impl Escrow {
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        router_id: AccountId,
        oracle_pk: PublicKey,
        receipt_pk: PublicKey,
        demo_mode: bool,
    ) -> Self {
        Self {
            owner_id,
            token_id,
            router_id,
            oracle_pk: ed25519_bytes(&oracle_pk),
            receipt_pk: ed25519_bytes(&receipt_pk),
            params: if demo_mode {
                demo_params()
            } else {
                real_params()
            },
            paused: false,
            batches: LookupMap::new(StorageKey::Batches),
            payouts: LookupMap::new(StorageKey::Payouts),
            firms: IterableMap::new(StorageKey::Firms),
            used_nonces: LookupSet::new(StorageKey::Nonces),
            claimable: LookupMap::new(StorageKey::Claimable),
            storage_credit: LookupMap::new(StorageKey::StorageCredit),
            next_batch_id: 0,
        }
    }

    // ----- owner: affects new batches only (batches snapshot keys at funding) -----

    #[payable]
    pub fn set_router(&mut self, router_id: AccountId) {
        self.assert_owner();
        self.router_id = router_id;
    }

    #[payable]
    pub fn set_oracle_pk(&mut self, pk: PublicKey) {
        self.assert_owner();
        self.oracle_pk = ed25519_bytes(&pk);
    }

    #[payable]
    pub fn set_receipt_pk(&mut self, pk: PublicKey) {
        self.assert_owner();
        self.receipt_pk = ed25519_bytes(&pk);
    }

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }
}

impl Escrow {
    pub(crate) fn assert_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner_id, "owner_only");
    }
}

#[cfg(test)]
mod tests;
