//! Domain-separated signed messages: `borsh((domain, escrow_id, payload))`, ed25519.
//! The TypeScript signer reproduces `tests/fixtures/signing-vectors.json` byte for byte.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U64;
use near_sdk::{env, near, AccountId};

pub const QUOTE_DOMAIN: &str = "elivo-quote-v1";
pub const PROOF_DOMAIN: &str = "elivo-proof-v1";
pub const EXCLUSION_DOMAIN: &str = "elivo-exclusion-v1";
pub const REASON_ACCOUNT_CLOSED: u8 = 1;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Quote {
    pub batch_id: u64,
    pub payout_id: u32,
    pub firm_id: AccountId,
    pub quote_bps: u16,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct DeliveryProof {
    pub batch_id: u64,
    pub payout_id: u32,
    pub firm_id: AccountId,
    pub delivered_at_ns: u64,
    pub proof_ref: String,
    pub nonce: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Exclusion {
    pub batch_id: u64,
    pub payout_id: u32,
    pub firm_id: AccountId,
    pub reason_code: u8,
    pub observed_at_ns: u64,
    pub nonce: u64,
}

/// JSON form of [`DeliveryProof`]: u64 fields as strings so JavaScript keeps full precision.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DeliveryProofJson {
    pub batch_id: U64,
    pub payout_id: u32,
    pub firm_id: AccountId,
    pub delivered_at_ns: U64,
    pub proof_ref: String,
    pub nonce: U64,
}

impl From<DeliveryProofJson> for DeliveryProof {
    fn from(j: DeliveryProofJson) -> Self {
        DeliveryProof {
            batch_id: j.batch_id.0,
            payout_id: j.payout_id,
            firm_id: j.firm_id,
            delivered_at_ns: j.delivered_at_ns.0,
            proof_ref: j.proof_ref,
            nonce: j.nonce.0,
        }
    }
}

/// JSON form of [`Exclusion`].
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ExclusionJson {
    pub batch_id: U64,
    pub payout_id: u32,
    pub firm_id: AccountId,
    pub reason_code: u8,
    pub observed_at_ns: U64,
    pub nonce: U64,
}

impl From<ExclusionJson> for Exclusion {
    fn from(j: ExclusionJson) -> Self {
        Exclusion {
            batch_id: j.batch_id.0,
            payout_id: j.payout_id,
            firm_id: j.firm_id,
            reason_code: j.reason_code,
            observed_at_ns: j.observed_at_ns.0,
            nonce: j.nonce.0,
        }
    }
}

pub fn message<T: BorshSerialize>(domain: &str, escrow: &AccountId, payload: &T) -> Vec<u8> {
    near_sdk::borsh::to_vec(&(domain, escrow, payload)).expect("borsh")
}

pub fn verify(pk: &[u8; 32], msg: &[u8], sig: &[u8]) -> bool {
    let Ok(sig) = <&[u8; 64]>::try_from(sig) else {
        return false;
    };
    env::ed25519_verify(sig, msg, pk)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::AccountId;

    const VECTORS: &str = include_str!("../tests/fixtures/signing-vectors.json");

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn sample_quote() -> Quote {
        Quote {
            batch_id: 1,
            payout_id: 2,
            firm_id: a("mx1.test.near"),
            quote_bps: 20,
        }
    }

    fn sample_proof() -> DeliveryProof {
        DeliveryProof {
            batch_id: 1,
            payout_id: 2,
            firm_id: a("mx1.test.near"),
            delivered_at_ns: 1_731_300_000_000_000_000,
            proof_ref: "CEP-SIM-0001".into(),
            nonce: 42,
        }
    }

    fn sample_exclusion() -> Exclusion {
        Exclusion {
            batch_id: 1,
            payout_id: 3,
            firm_id: a("mx2.test.near"),
            reason_code: REASON_ACCOUNT_CLOSED,
            observed_at_ns: 1_731_300_000_000_000_000,
            nonce: 43,
        }
    }

    fn borsh_str(out: &mut Vec<u8>, s: &str) {
        out.extend_from_slice(&(s.len() as u32).to_le_bytes());
        out.extend_from_slice(s.as_bytes());
    }

    #[test]
    fn quote_message_layout() {
        let mut want = Vec::new();
        borsh_str(&mut want, "elivo-quote-v1");
        borsh_str(&mut want, "escrow.test.near");
        want.extend_from_slice(&1u64.to_le_bytes());
        want.extend_from_slice(&2u32.to_le_bytes());
        borsh_str(&mut want, "mx1.test.near");
        want.extend_from_slice(&20u16.to_le_bytes());
        assert_eq!(
            message(QUOTE_DOMAIN, &a("escrow.test.near"), &sample_quote()),
            want
        );
    }

    #[test]
    fn domains_differ() {
        let e = a("escrow.test.near");
        assert_ne!(
            message(QUOTE_DOMAIN, &e, &sample_quote()),
            message(PROOF_DOMAIN, &e, &sample_quote())
        );
    }

    fn vectors() -> Vec<serde_json::Value> {
        serde_json::from_str(VECTORS).unwrap()
    }

    fn expected_message(v: &serde_json::Value) -> Vec<u8> {
        let e = a(v["escrow_id"].as_str().unwrap());
        match v["domain"].as_str().unwrap() {
            QUOTE_DOMAIN => message(QUOTE_DOMAIN, &e, &sample_quote()),
            PROOF_DOMAIN => message(PROOF_DOMAIN, &e, &sample_proof()),
            EXCLUSION_DOMAIN => message(EXCLUSION_DOMAIN, &e, &sample_exclusion()),
            d => panic!("unknown domain {d}"),
        }
    }

    #[test]
    fn message_matches_vectors() {
        let vs = vectors();
        assert_eq!(vs.len(), 3);
        for v in vs {
            assert_eq!(
                hex::encode(expected_message(&v)),
                v["message_hex"].as_str().unwrap()
            );
        }
    }

    fn pk_of(v: &serde_json::Value) -> [u8; 32] {
        bs58::decode(v["public_key_b58"].as_str().unwrap())
            .into_vec()
            .unwrap()
            .try_into()
            .unwrap()
    }

    #[test]
    fn verify_accepts_vector_signature() {
        for v in vectors() {
            let sig = hex::decode(v["signature_hex"].as_str().unwrap()).unwrap();
            assert!(verify(&pk_of(&v), &expected_message(&v), &sig));
        }
    }

    #[test]
    fn verify_rejects_flipped_byte() {
        let v = &vectors()[0];
        let mut sig = hex::decode(v["signature_hex"].as_str().unwrap()).unwrap();
        sig[10] ^= 1;
        assert!(!verify(&pk_of(v), &expected_message(v), &sig));
        let sig = hex::decode(v["signature_hex"].as_str().unwrap()).unwrap();
        let mut msg = expected_message(v);
        msg[0] ^= 1;
        assert!(!verify(&pk_of(v), &msg, &sig));
    }

    #[test]
    fn verify_rejects_short_sig() {
        let v = &vectors()[0];
        let sig = hex::decode(v["signature_hex"].as_str().unwrap()).unwrap();
        assert!(!verify(&pk_of(v), &expected_message(v), &sig[..63]));
    }

    #[test]
    fn proof_json_roundtrip_uses_strings_for_u64() {
        let j: DeliveryProofJson = serde_json::from_str(
            r#"{"batch_id":"1","payout_id":2,"firm_id":"mx1.test.near","delivered_at_ns":"1731300000000000000","proof_ref":"CEP-SIM-0001","nonce":"42"}"#,
        )
        .unwrap();
        assert_eq!(DeliveryProof::from(j), sample_proof());
    }

    /// Regenerates the fixture. Run with: cargo test -p elivo-escrow write_vectors -- --ignored
    #[test]
    #[ignore]
    fn write_vectors() {
        use ed25519_dalek::{Signer, SigningKey};
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk_b58 = bs58::encode(sk.verifying_key().as_bytes()).into_string();
        let e = a("escrow.test.near");
        let q = sample_quote();
        let p = sample_proof();
        let x = sample_exclusion();
        let entries = [
            (
                QUOTE_DOMAIN,
                message(QUOTE_DOMAIN, &e, &q),
                serde_json::json!({
                "batch_id": "1", "payout_id": 2, "firm_id": "mx1.test.near", "quote_bps": 20 }),
            ),
            (
                PROOF_DOMAIN,
                message(PROOF_DOMAIN, &e, &p),
                serde_json::json!({
                "batch_id": "1", "payout_id": 2, "firm_id": "mx1.test.near",
                "delivered_at_ns": "1731300000000000000", "proof_ref": "CEP-SIM-0001", "nonce": "42" }),
            ),
            (
                EXCLUSION_DOMAIN,
                message(EXCLUSION_DOMAIN, &e, &x),
                serde_json::json!({
                "batch_id": "1", "payout_id": 3, "firm_id": "mx2.test.near", "reason_code": 1,
                "observed_at_ns": "1731300000000000000", "nonce": "43" }),
            ),
        ];
        let out: Vec<serde_json::Value> = entries
            .into_iter()
            .map(|(domain, msg, payload)| {
                serde_json::json!({
                    "domain": domain,
                    "escrow_id": "escrow.test.near",
                    "payload": payload,
                    "message_hex": hex::encode(&msg),
                    "seed_hex": hex::encode([7u8; 32]),
                    "public_key_b58": pk_b58,
                    "signature_hex": hex::encode(sk.sign(&msg).to_bytes()),
                })
            })
            .collect();
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/signing-vectors.json"
        );
        std::fs::write(path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
    }
}
