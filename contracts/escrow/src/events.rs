//! NEP-297 events, standard `elivo`, version `1.0.0`. Ids, amounts, hashes and accounts only.
use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub const STANDARD: &str = "elivo";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let body = json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
