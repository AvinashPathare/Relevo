use super::types::Params;

const BPS: u128 = 10_000;

/// `amount * bps / 10_000`, rounded down.
pub fn fee_for(amount: u128, bps: u16) -> u128 {
    amount.saturating_mul(bps as u128) / BPS
}

/// What a funder locks for one payout: the amount plus the maximum fee buffer.
pub fn locked_for(p: &Params, amount: u128) -> u128 {
    amount.saturating_add(fee_for(amount, p.max_fee_bps))
}

/// Whole periods late at time `t`, rounded up, minimum one once late.
pub fn periods_late(p: &Params, t: u64, cutoff: u64) -> u64 {
    if t <= cutoff {
        return 0;
    }
    let late = t - cutoff;
    late.div_ceil(p.period_ns).max(1)
}

/// Penalty for `periods` late, bounded by the 2% cap (net of prior penalties) and the bond.
pub fn penalty_for(
    p: &Params,
    amount: u128,
    periods: u64,
    penalties_total: u128,
    bond: u128,
) -> u128 {
    let rate = p.penalty_bps_per_period.max(1) as u64;
    let max_periods = (p.cap_bps as u64) / rate;
    let effective_bps = periods.min(max_periods).saturating_mul(rate);
    let by_time = amount.saturating_mul(effective_bps as u128) / BPS;
    let cap_left = fee_for(amount, p.cap_bps).saturating_sub(penalties_total);
    by_time.min(cap_left).min(bond)
}

/// Demo mode: one penalty "hour" is 10 seconds.
pub fn demo_params() -> Params {
    Params {
        period_ns: 10_000_000_000,
        penalty_bps_per_period: 1,
        cap_bps: 200,
        max_fee_bps: 25,
        exposure_multiple: 20,
        reroute_window_ns: 30_000_000_000,
        min_payout: 1_000_000,
        max_batch: 50,
    }
}

/// Real-time mode: one-hour periods.
pub fn real_params() -> Params {
    Params {
        period_ns: 3_600_000_000_000,
        reroute_window_ns: 3_600_000_000_000,
        ..demo_params()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CUTOFF: u64 = 1_000_000_000_000;

    #[test]
    fn locked_rounds_down() {
        assert_eq!(locked_for(&demo_params(), 1_000_001), 1_002_501);
    }

    #[test]
    fn periods_not_late() {
        assert_eq!(periods_late(&demo_params(), 100, 100), 0);
        assert_eq!(periods_late(&demo_params(), 99, 100), 0);
    }

    #[test]
    fn periods_min_one() {
        assert_eq!(periods_late(&demo_params(), CUTOFF + 1, CUTOFF), 1);
    }

    #[test]
    fn periods_ceil() {
        assert_eq!(
            periods_late(&demo_params(), CUTOFF + 10_000_000_000, CUTOFF),
            1
        );
        assert_eq!(
            periods_late(&demo_params(), CUTOFF + 10_000_000_001, CUTOFF),
            2
        );
    }

    #[test]
    fn penalty_24_periods_on_10k() {
        assert_eq!(
            penalty_for(&demo_params(), 10_000_000_000, 24, 0, u128::MAX),
            24_000_000
        );
    }

    #[test]
    fn penalty_caps_at_2pct() {
        assert_eq!(
            penalty_for(&demo_params(), 10_000_000_000, 500, 0, u128::MAX),
            200_000_000
        );
        assert_eq!(
            penalty_for(&demo_params(), 10_000_000_000, u64::MAX, 0, u128::MAX),
            200_000_000
        );
    }

    #[test]
    fn penalty_respects_prior_penalties() {
        assert_eq!(
            penalty_for(&demo_params(), 10_000_000_000, 500, 150_000_000, u128::MAX),
            50_000_000
        );
        assert_eq!(
            penalty_for(&demo_params(), 10_000_000_000, 500, 200_000_000, u128::MAX),
            0
        );
    }

    #[test]
    fn penalty_capped_by_bond() {
        assert_eq!(penalty_for(&demo_params(), 10_000_000_000, 24, 0, 5), 5);
    }

    #[test]
    fn real_params_use_one_hour_periods() {
        assert_eq!(real_params().period_ns, 3_600_000_000_000);
        assert_eq!(demo_params().period_ns, 10_000_000_000);
    }
}
