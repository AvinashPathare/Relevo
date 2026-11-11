use near_sdk::near;

pub mod logic;

#[near(contract_state)]
#[derive(Default)]
pub struct Escrow {}

#[near]
impl Escrow {}
