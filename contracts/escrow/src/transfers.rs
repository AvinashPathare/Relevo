//! Outgoing token transfers. State is always written before `send`; a failed transfer is
//! credited to `claimable` and can be retried with `claim()`.
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, PromiseError};

use crate::events::emit;
use crate::{Escrow, EscrowExt};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Escrow {
    #[private]
    pub fn on_transfer_done(
        &mut self,
        receiver: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() {
            let bal = self.claimable.get(&receiver).copied().unwrap_or(0) + amount.0;
            self.claimable.insert(receiver.clone(), bal);
            emit(
                "transfer_failed",
                json!({ "account_id": receiver, "amount": amount.0.to_string() }),
            );
        }
    }

    pub fn claim(&mut self) {
        let who = env::predecessor_account_id();
        let amount = self.claimable.remove(&who).unwrap_or(0);
        if amount == 0 {
            env::panic_str("nothing_to_claim");
        }
        emit(
            "claimed",
            json!({ "account_id": who, "amount": amount.to_string() }),
        );
        self.send(who, amount);
    }
}

impl Escrow {
    pub(crate) fn send(&self, receiver: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        ext_ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(receiver.clone(), U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_transfer_done(receiver, U128(amount)),
            )
            .detach(); // scheduled independently; several sends per call are allowed
    }
}
