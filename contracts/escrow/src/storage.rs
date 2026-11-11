//! Prepaid NEAR storage credit per account. Anyone may top up anyone.
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::{Escrow, EscrowExt};

/// Minimum first deposit for an account (0.01 NEAR): a new credit entry costs the contract
/// storage, so it must be paid for. Top-ups of an existing entry may be any size.
pub const MIN_NEW_STORAGE_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;

#[near]
impl Escrow {
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let add = env::attached_deposit().as_yoctonear();
        let existing = self.storage_credit.get(&account).copied();
        let min = if existing.is_some() {
            1
        } else {
            MIN_NEW_STORAGE_DEPOSIT
        };
        require!(add >= min, "deposit_below_minimum");
        let bal = existing.unwrap_or(0) + add;
        self.storage_credit.insert(account, bal);
        U128(bal)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.storage_credit.get(&account_id).copied().unwrap_or(0))
    }
}

impl Escrow {
    /// Flush cached collections, then debit `account` for bytes added since `before`.
    pub(crate) fn charge_storage(&mut self, account: &AccountId, before: u64) {
        self.flush_all();
        let after = env::storage_usage();
        if after <= before {
            return;
        }
        let cost = (after - before) as u128 * env::storage_byte_cost().as_yoctonear();
        let bal = self.storage_credit.get(account).copied().unwrap_or(0);
        require!(bal >= cost, "insufficient_storage_credit");
        self.storage_credit.insert(account.clone(), bal - cost);
        self.storage_credit.flush();
    }

    pub(crate) fn flush_all(&mut self) {
        self.batches.flush();
        self.payouts.flush();
        self.firms.flush();
        self.claimable.flush();
        self.storage_credit.flush();
    }
}
