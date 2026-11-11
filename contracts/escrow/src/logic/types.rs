use near_sdk::{near, AccountId};

/// Contract parameters that drive the money math.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    pub period_ns: u64,
    pub penalty_bps_per_period: u16,
    pub cap_bps: u16,
    pub max_fee_bps: u16,
    pub exposure_multiple: u32,
    pub reroute_window_ns: u64,
    pub min_payout: u128,
    pub max_batch: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutState {
    Funded,
    Assigned,
    Delivered,
    Refunded,
}

impl PayoutState {
    pub fn is_terminal(self) -> bool {
        matches!(self, PayoutState::Delivered | PayoutState::Refunded)
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    pub amount: u128,
    /// amount + max fee buffer; what the funder locked for this payout.
    pub locked: u128,
    pub state: PayoutState,
    pub firm: Option<AccountId>,
    pub quote_bps: u16,
    pub cutoff_ns: u64,
    pub final_deadline_ns: u64,
    pub penalties_total: u128,
    pub firms_tried: Vec<AccountId>,
    pub excluded: bool,
    pub delivered_at_ns: Option<u64>,
    pub proof_ref: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Firm {
    pub pk: [u8; 32],
    pub approved: bool,
    pub bond: u128,
    pub open_exposure: u128,
    pub delivered_on_time: u32,
    pub delivered_late: u32,
    pub penalties_paid: u128,
    pub volume: u128,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PayoutIn {
    pub id: u32,
    pub amount: u128,
    pub cutoff_in_ns: u64,
    pub deadline_in_ns: u64,
}

/// Token movements a transition requires. `pay_funder` already includes `penalty`.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Outcome {
    pub pay_firm: u128,
    pub pay_funder: u128,
    pub penalty: u128,
    pub periods: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoreError {
    EmptyBatch,
    BatchTooLarge,
    BadPayoutId,
    BelowMinPayout,
    BadTiming,
    TotalMismatch,
    WrongState,
    FirmNotApproved,
    QuoteTooHigh,
    ExposureExceeded,
    CutoffPassed,
    NotLate,
    FirmAlreadyTried,
    WrongFirm,
    DeliveredInFuture,
    NotRefundableYet,
    BondTooLow,
}

impl CoreError {
    pub fn as_str(self) -> &'static str {
        match self {
            CoreError::EmptyBatch => "empty_batch",
            CoreError::BatchTooLarge => "batch_too_large",
            CoreError::BadPayoutId => "bad_payout_id",
            CoreError::BelowMinPayout => "below_min_payout",
            CoreError::BadTiming => "bad_timing",
            CoreError::TotalMismatch => "total_mismatch",
            CoreError::WrongState => "wrong_state",
            CoreError::FirmNotApproved => "firm_not_approved",
            CoreError::QuoteTooHigh => "quote_too_high",
            CoreError::ExposureExceeded => "exposure_exceeded",
            CoreError::CutoffPassed => "cutoff_passed",
            CoreError::NotLate => "not_late",
            CoreError::FirmAlreadyTried => "firm_already_tried",
            CoreError::WrongFirm => "wrong_firm",
            CoreError::DeliveredInFuture => "delivered_in_future",
            CoreError::NotRefundableYet => "not_refundable_yet",
            CoreError::BondTooLow => "bond_too_low",
        }
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
