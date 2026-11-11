use near_sdk::near;

pub mod logic;
pub mod signing;

#[near(contract_state)]
#[derive(Default)]
pub struct Escrow {}

#[near]
impl Escrow {}
