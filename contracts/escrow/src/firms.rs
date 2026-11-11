//! Firm registry: firms register their quote-signing key; the owner approves them.
use near_sdk::{env, near, require, serde_json::json, AccountId, PublicKey};

use crate::events::emit;
use crate::logic::types::Firm;
use crate::{ed25519_bytes, Escrow, EscrowExt};

#[near]
impl Escrow {
    /// Register (or rotate) the caller's ed25519 quote key. Storage is charged to the caller.
    pub fn register_firm(&mut self, pk: PublicKey) {
        let firm_id = env::predecessor_account_id();
        let before = env::storage_usage();
        let mut firm = self.firms.get(&firm_id).cloned().unwrap_or_default();
        firm.pk = ed25519_bytes(&pk);
        self.firms.insert(firm_id.clone(), firm);
        self.charge_storage(&firm_id, before);
        emit("firm_registered", json!({ "firm_id": firm_id }));
    }

    #[payable]
    pub fn approve_firm(&mut self, firm_id: AccountId) {
        self.set_approval(firm_id, true);
    }

    #[payable]
    pub fn revoke_firm(&mut self, firm_id: AccountId) {
        self.set_approval(firm_id, false);
    }
}

impl Escrow {
    fn set_approval(&mut self, firm_id: AccountId, approved: bool) {
        self.assert_owner();
        let firm = self.firms.get_mut(&firm_id);
        require!(firm.is_some(), "unknown_firm");
        firm.unwrap().approved = approved;
        emit(
            "firm_approved",
            json!({ "firm_id": firm_id, "approved": approved }),
        );
    }

    pub(crate) fn firm(&self, id: &AccountId) -> Firm {
        self.firms
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown_firm"))
    }
}
