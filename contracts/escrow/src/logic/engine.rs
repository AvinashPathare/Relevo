//! State transitions. Every function validates first and mutates only after all checks pass,
//! so an `Err` leaves its arguments untouched.

use near_sdk::AccountId;

use super::math::{fee_for, locked_for, penalty_for, periods_late};
use super::types::{CoreError, Firm, Outcome, Params, Payout, PayoutIn, PayoutState};

type R<T> = Result<T, CoreError>;

pub fn new_payouts(p: &Params, items: &[PayoutIn], transferred: u128, now: u64) -> R<Vec<Payout>> {
    if items.is_empty() {
        return Err(CoreError::EmptyBatch);
    }
    if items.len() > p.max_batch as usize {
        return Err(CoreError::BatchTooLarge);
    }
    let mut total: u128 = 0;
    for (i, it) in items.iter().enumerate() {
        if it.id as usize != i {
            return Err(CoreError::BadPayoutId);
        }
        if it.amount < p.min_payout {
            return Err(CoreError::BelowMinPayout);
        }
        if it.cutoff_in_ns == 0 || it.cutoff_in_ns >= it.deadline_in_ns {
            return Err(CoreError::BadTiming);
        }
        total = total.saturating_add(locked_for(p, it.amount));
    }
    if total != transferred {
        return Err(CoreError::TotalMismatch);
    }
    Ok(items
        .iter()
        .map(|it| Payout {
            amount: it.amount,
            locked: locked_for(p, it.amount),
            state: PayoutState::Funded,
            firm: None,
            quote_bps: 0,
            cutoff_ns: now.saturating_add(it.cutoff_in_ns),
            final_deadline_ns: now.saturating_add(it.deadline_in_ns),
            penalties_total: 0,
            firms_tried: Vec::new(),
            excluded: false,
            delivered_at_ns: None,
            proof_ref: None,
        })
        .collect())
}

pub fn post_bond(firm: &mut Firm, amount: u128) {
    firm.bond = firm.bond.saturating_add(amount);
}

fn check_assignable(p: &Params, firm: &Firm, amount: u128, quote_bps: u16) -> R<()> {
    if !firm.approved {
        return Err(CoreError::FirmNotApproved);
    }
    if quote_bps > p.max_fee_bps {
        return Err(CoreError::QuoteTooHigh);
    }
    let limit = firm.bond.saturating_mul(p.exposure_multiple as u128);
    if firm.open_exposure.saturating_add(amount) > limit {
        return Err(CoreError::ExposureExceeded);
    }
    Ok(())
}

fn charge(p: &Params, payout: &mut Payout, firm: &mut Firm, t: u64) -> (u128, u64) {
    let periods = periods_late(p, t, payout.cutoff_ns);
    let penalty = penalty_for(p, payout.amount, periods, payout.penalties_total, firm.bond);
    firm.bond -= penalty;
    firm.penalties_paid = firm.penalties_paid.saturating_add(penalty);
    payout.penalties_total += penalty;
    (penalty, periods)
}

fn release(firm: &mut Firm, amount: u128) {
    firm.open_exposure = firm.open_exposure.saturating_sub(amount);
}

pub fn assign(
    p: &Params,
    payout: &mut Payout,
    firm_id: &AccountId,
    firm: &mut Firm,
    quote_bps: u16,
    now: u64,
) -> R<()> {
    if payout.state != PayoutState::Funded {
        return Err(CoreError::WrongState);
    }
    if now >= payout.cutoff_ns {
        return Err(CoreError::CutoffPassed);
    }
    check_assignable(p, firm, payout.amount, quote_bps)?;
    firm.open_exposure += payout.amount;
    payout.state = PayoutState::Assigned;
    payout.firm = Some(firm_id.clone());
    payout.quote_bps = quote_bps;
    payout.firms_tried.push(firm_id.clone());
    Ok(())
}

pub fn reroute(
    p: &Params,
    payout: &mut Payout,
    old: &mut Firm,
    new_id: &AccountId,
    new: &mut Firm,
    quote_bps: u16,
    now: u64,
) -> R<Outcome> {
    if payout.state != PayoutState::Assigned || payout.excluded {
        return Err(CoreError::WrongState);
    }
    if now <= payout.cutoff_ns {
        return Err(CoreError::NotLate);
    }
    if now >= payout.final_deadline_ns {
        return Err(CoreError::CutoffPassed);
    }
    if payout.firms_tried.contains(new_id) {
        return Err(CoreError::FirmAlreadyTried);
    }
    check_assignable(p, new, payout.amount, quote_bps)?;
    let (penalty, periods) = charge(p, payout, old, now);
    release(old, payout.amount);
    new.open_exposure += payout.amount;
    payout.firm = Some(new_id.clone());
    payout.quote_bps = quote_bps;
    payout.firms_tried.push(new_id.clone());
    payout.cutoff_ns = now
        .saturating_add(p.reroute_window_ns)
        .min(payout.final_deadline_ns);
    Ok(Outcome {
        pay_firm: 0,
        pay_funder: penalty,
        penalty,
        periods,
    })
}

pub fn settle(
    p: &Params,
    payout: &mut Payout,
    firm_id: &AccountId,
    firm: &mut Firm,
    delivered_at: u64,
    proof_ref: String,
    now: u64,
) -> R<Outcome> {
    if payout.state != PayoutState::Assigned || payout.excluded {
        return Err(CoreError::WrongState);
    }
    if payout.firm.as_ref() != Some(firm_id) {
        return Err(CoreError::WrongFirm);
    }
    if delivered_at > now {
        return Err(CoreError::DeliveredInFuture);
    }
    let (penalty, periods) = charge(p, payout, firm, delivered_at);
    release(firm, payout.amount);
    if periods == 0 {
        firm.delivered_on_time += 1;
    } else {
        firm.delivered_late += 1;
    }
    firm.volume = firm.volume.saturating_add(payout.amount);
    let pay_firm = payout.amount + fee_for(payout.amount, payout.quote_bps);
    let leftover = payout.locked.saturating_sub(pay_firm);
    payout.state = PayoutState::Delivered;
    payout.delivered_at_ns = Some(delivered_at);
    payout.proof_ref = Some(proof_ref);
    Ok(Outcome {
        pay_firm,
        pay_funder: leftover + penalty,
        penalty,
        periods,
    })
}

pub fn exclude(payout: &mut Payout, firm_id: &AccountId, firm: &mut Firm) -> R<()> {
    if payout.state != PayoutState::Assigned || payout.excluded {
        return Err(CoreError::WrongState);
    }
    if payout.firm.as_ref() != Some(firm_id) {
        return Err(CoreError::WrongFirm);
    }
    release(firm, payout.amount);
    payout.excluded = true;
    Ok(())
}

pub fn refund(p: &Params, payout: &mut Payout, firm: Option<&mut Firm>, now: u64) -> R<Outcome> {
    if payout.state.is_terminal() {
        return Err(CoreError::WrongState);
    }
    if !payout.excluded && now <= payout.final_deadline_ns {
        return Err(CoreError::NotRefundableYet);
    }
    let needs_firm = payout.state == PayoutState::Assigned && !payout.excluded;
    let (mut penalty, mut periods) = (0, 0);
    if needs_firm {
        let f = firm.ok_or(CoreError::WrongFirm)?;
        (penalty, periods) = charge(p, payout, f, now);
        release(f, payout.amount);
    }
    payout.state = PayoutState::Refunded;
    Ok(Outcome {
        pay_firm: 0,
        pay_funder: payout.locked + penalty,
        penalty,
        periods,
    })
}

pub fn withdraw_bond(p: &Params, firm: &mut Firm, amount: u128) -> R<()> {
    if amount > firm.bond {
        return Err(CoreError::BondTooLow);
    }
    let remaining = firm.bond - amount;
    if remaining.saturating_mul(p.exposure_multiple as u128) < firm.open_exposure {
        return Err(CoreError::BondTooLow);
    }
    firm.bond = remaining;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logic::math::{demo_params, locked_for};
    use crate::logic::types::*;
    use near_sdk::AccountId;

    const S: u64 = 1_000_000_000;
    const NOW: u64 = 1_000_000 * S;
    const P: u64 = 10 * S; // demo period

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn p() -> Params {
        demo_params()
    }
    fn items_with(amounts: &[u128], cut: u64, dl: u64) -> Vec<PayoutIn> {
        amounts
            .iter()
            .enumerate()
            .map(|(i, &amount)| PayoutIn {
                id: i as u32,
                amount,
                cutoff_in_ns: cut,
                deadline_in_ns: dl,
            })
            .collect()
    }
    fn items(amounts: &[u128]) -> Vec<PayoutIn> {
        items_with(amounts, 60 * S, 600 * S)
    }
    fn total(amounts: &[u128]) -> u128 {
        amounts.iter().map(|&x| locked_for(&p(), x)).sum()
    }
    fn funded_with(amount: u128, cut: u64, dl: u64) -> Payout {
        new_payouts(&p(), &items_with(&[amount], cut, dl), total(&[amount]), NOW)
            .unwrap()
            .remove(0)
    }
    fn funded(amount: u128) -> Payout {
        funded_with(amount, 60 * S, 600 * S)
    }
    fn firm(bond: u128) -> Firm {
        Firm {
            approved: true,
            bond,
            ..Default::default()
        }
    }
    fn assigned(amount: u128, id: &str, f: &mut Firm, bps: u16) -> Payout {
        let mut po = funded(amount);
        assign(&p(), &mut po, &a(id), f, bps, NOW).unwrap();
        po
    }

    // ---------- new_payouts ----------
    #[test]
    fn new_payouts_happy() {
        let v = new_payouts(
            &p(),
            &items(&[1_000_000, 2_000_000]),
            total(&[1_000_000, 2_000_000]),
            NOW,
        )
        .unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[1].amount, 2_000_000);
        assert_eq!(v[1].locked, 2_005_000);
        assert_eq!(v[0].state, PayoutState::Funded);
        assert_eq!(v[0].cutoff_ns, NOW + 60 * S);
        assert_eq!(v[0].final_deadline_ns, NOW + 600 * S);
        assert!(v[0].firm.is_none() && v[0].firms_tried.is_empty() && !v[0].excluded);
    }
    #[test]
    fn new_payouts_rejects_empty() {
        assert_eq!(new_payouts(&p(), &[], 0, NOW), Err(CoreError::EmptyBatch));
    }
    #[test]
    fn new_payouts_rejects_51() {
        let am = vec![1_000_000u128; 51];
        assert_eq!(
            new_payouts(&p(), &items(&am), total(&am), NOW),
            Err(CoreError::BatchTooLarge)
        );
        let am = vec![1_000_000u128; 50];
        assert!(new_payouts(&p(), &items(&am), total(&am), NOW).is_ok());
    }
    #[test]
    fn new_payouts_rejects_bad_ids() {
        let mut it = items(&[1_000_000, 1_000_000]);
        it[0].id = 1;
        it[1].id = 0;
        assert_eq!(
            new_payouts(&p(), &it, total(&[1_000_000, 1_000_000]), NOW),
            Err(CoreError::BadPayoutId)
        );
    }
    #[test]
    fn new_payouts_rejects_total_off_by_one() {
        let t = total(&[1_000_001]);
        assert_eq!(
            new_payouts(&p(), &items(&[1_000_001]), t - 1, NOW),
            Err(CoreError::TotalMismatch)
        );
        assert_eq!(
            new_payouts(&p(), &items(&[1_000_001]), t + 1, NOW),
            Err(CoreError::TotalMismatch)
        );
    }
    #[test]
    fn new_payouts_rejects_bad_timing() {
        let t = total(&[1_000_000]);
        assert_eq!(
            new_payouts(&p(), &items_with(&[1_000_000], 0, 10), t, NOW),
            Err(CoreError::BadTiming)
        );
        assert_eq!(
            new_payouts(&p(), &items_with(&[1_000_000], 10, 10), t, NOW),
            Err(CoreError::BadTiming)
        );
    }
    #[test]
    fn new_payouts_rejects_below_min() {
        assert_eq!(
            new_payouts(&p(), &items(&[999_999]), total(&[999_999]), NOW),
            Err(CoreError::BelowMinPayout)
        );
    }

    // ---------- assign ----------
    #[test]
    fn assign_happy_sets_exposure() {
        let mut f = firm(1_000_000_000);
        let po = assigned(1_000_000_000, "mx1", &mut f, 20);
        assert_eq!(po.state, PayoutState::Assigned);
        assert_eq!(po.firm, Some(a("mx1")));
        assert_eq!(po.quote_bps, 20);
        assert_eq!(po.firms_tried, vec![a("mx1")]);
        assert_eq!(f.open_exposure, 1_000_000_000);
    }
    #[test]
    fn assign_rejects_unapproved() {
        let mut f = firm(1_000_000_000);
        f.approved = false;
        let mut po = funded(1_000_000);
        assert_eq!(
            assign(&p(), &mut po, &a("mx1"), &mut f, 20, NOW),
            Err(CoreError::FirmNotApproved)
        );
        assert_eq!(po.state, PayoutState::Funded);
    }
    #[test]
    fn assign_rejects_quote_26bps() {
        let mut f = firm(1_000_000_000);
        let mut po = funded(1_000_000);
        assert_eq!(
            assign(&p(), &mut po, &a("mx1"), &mut f, 26, NOW),
            Err(CoreError::QuoteTooHigh)
        );
        assert!(assign(&p(), &mut po, &a("mx1"), &mut f, 25, NOW).is_ok());
    }
    #[test]
    fn assign_rejects_over_exposure() {
        let mut f = firm(1_000_000);
        let mut po = funded(20_000_001);
        assert_eq!(
            assign(&p(), &mut po, &a("mx1"), &mut f, 20, NOW),
            Err(CoreError::ExposureExceeded)
        );
        assert_eq!(f.open_exposure, 0);
        let mut po = funded(20_000_000);
        assert!(assign(&p(), &mut po, &a("mx1"), &mut f, 20, NOW).is_ok());
    }
    #[test]
    fn assign_rejects_after_cutoff() {
        let mut f = firm(1_000_000_000);
        let mut po = funded(1_000_000);
        let cut = po.cutoff_ns;
        assert_eq!(
            assign(&p(), &mut po, &a("mx1"), &mut f, 20, cut),
            Err(CoreError::CutoffPassed)
        );
    }
    #[test]
    fn assign_rejects_wrong_state() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        assert_eq!(
            assign(&p(), &mut po, &a("mx1"), &mut f, 20, NOW),
            Err(CoreError::WrongState)
        );
        assert_eq!(f.open_exposure, 1_000_000);
    }

    // ---------- reroute ----------
    #[test]
    fn reroute_charges_late_firm() {
        let (mut mx3, mut mx2) = (firm(10_000_000_000), firm(10_000_000_000));
        let mut po = assigned(10_000_000_000, "mx3", &mut mx3, 18);
        let now = po.cutoff_ns + 3 * P;
        let o = reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, now).unwrap();
        assert_eq!(
            o,
            Outcome {
                pay_firm: 0,
                pay_funder: 3_000_000,
                penalty: 3_000_000,
                periods: 3
            }
        );
        assert_eq!(mx3.bond, 10_000_000_000 - 3_000_000);
        assert_eq!(mx3.penalties_paid, 3_000_000);
        assert_eq!(mx3.open_exposure, 0);
        assert_eq!(mx2.open_exposure, 10_000_000_000);
        assert_eq!(po.firm, Some(a("mx2")));
        assert_eq!(po.quote_bps, 20);
        assert_eq!(po.cutoff_ns, now + 30 * S);
        assert_eq!(po.penalties_total, 3_000_000);
        assert_eq!(po.firms_tried, vec![a("mx3"), a("mx2")]);
    }
    #[test]
    fn reroute_at_exact_cutoff_rejected() {
        let (mut mx3, mut mx2) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000, "mx3", &mut mx3, 18);
        let cut = po.cutoff_ns;
        assert_eq!(
            reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, cut),
            Err(CoreError::NotLate)
        );
        assert!(reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, cut + 1).is_ok());
    }
    #[test]
    fn reroute_rejects_tried_firm() {
        let mut mx3 = firm(1_000_000_000);
        let mut mx3b = mx3.clone();
        let mut po = assigned(1_000_000, "mx3", &mut mx3, 18);
        let t = po.cutoff_ns + 1;
        assert_eq!(
            reroute(&p(), &mut po, &mut mx3, &a("mx3"), &mut mx3b, 20, t),
            Err(CoreError::FirmAlreadyTried)
        );
    }
    #[test]
    fn reroute_rejects_excluded() {
        let (mut mx3, mut mx2) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000, "mx3", &mut mx3, 18);
        exclude(&mut po, &a("mx3"), &mut mx3).unwrap();
        let t = po.cutoff_ns + 1;
        assert_eq!(
            reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, t),
            Err(CoreError::WrongState)
        );
    }
    #[test]
    fn reroute_after_final_deadline_rejected() {
        let (mut mx3, mut mx2) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000, "mx3", &mut mx3, 18);
        let t = po.final_deadline_ns;
        assert_eq!(
            reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, t),
            Err(CoreError::CutoffPassed)
        );
    }
    #[test]
    fn reroute_twice_respects_cap_total() {
        let (mut mx3, mut mx2, mut mx1) = (
            firm(10_000_000_000),
            firm(10_000_000_000),
            firm(10_000_000_000),
        );
        let mut po = funded_with(10_000_000_000, 60 * S, 100_000 * S);
        assign(&p(), &mut po, &a("mx3"), &mut mx3, 18, NOW).unwrap();
        let t1 = po.cutoff_ns + 150 * P;
        let o1 = reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, t1).unwrap();
        assert_eq!(o1.penalty, 150_000_000);
        let t2 = po.cutoff_ns + 150 * P;
        let o2 = reroute(&p(), &mut po, &mut mx2, &a("mx1"), &mut mx1, 22, t2).unwrap();
        assert_eq!(o2.penalty, 50_000_000);
        assert_eq!(po.penalties_total, 200_000_000);
    }

    // ---------- settle ----------
    #[test]
    fn settle_on_time_pays_fee_and_returns_leftover() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000_000, "mx1", &mut f, 20);
        let o = settle(
            &p(),
            &mut po,
            &a("mx1"),
            &mut f,
            NOW + S,
            "CEP-SIM-1".into(),
            NOW + 2 * S,
        )
        .unwrap();
        assert_eq!(
            o,
            Outcome {
                pay_firm: 1_002_000_000,
                pay_funder: 500_000,
                penalty: 0,
                periods: 0
            }
        );
        assert_eq!(po.state, PayoutState::Delivered);
        assert_eq!(po.delivered_at_ns, Some(NOW + S));
        assert_eq!(po.proof_ref.as_deref(), Some("CEP-SIM-1"));
        assert_eq!(f.open_exposure, 0);
        assert_eq!(f.delivered_on_time, 1);
        assert_eq!(f.volume, 1_000_000_000);
    }
    #[test]
    fn settle_late_charges_penalty() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000_000, "mx1", &mut f, 20);
        let at = po.cutoff_ns + 2 * P;
        let o = settle(&p(), &mut po, &a("mx1"), &mut f, at, "CEP".into(), at).unwrap();
        assert_eq!(o.penalty, 200_000);
        assert_eq!(o.pay_firm, 1_002_000_000);
        assert_eq!(o.pay_funder, 500_000 + 200_000);
        assert_eq!(f.bond, 1_000_000_000 - 200_000);
        assert_eq!(f.delivered_late, 1);
        assert_eq!(f.delivered_on_time, 0);
    }
    #[test]
    fn settle_wrong_firm_rejected() {
        let (mut f, mut g) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        assert_eq!(
            settle(&p(), &mut po, &a("mx2"), &mut g, NOW, "x".into(), NOW),
            Err(CoreError::WrongFirm)
        );
    }
    #[test]
    fn settle_future_delivery_rejected() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        assert_eq!(
            settle(&p(), &mut po, &a("mx1"), &mut f, NOW + 1, "x".into(), NOW),
            Err(CoreError::DeliveredInFuture)
        );
        assert_eq!(po.state, PayoutState::Assigned);
    }
    #[test]
    fn settle_twice_rejected() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        settle(&p(), &mut po, &a("mx1"), &mut f, NOW, "x".into(), NOW).unwrap();
        assert_eq!(
            settle(&p(), &mut po, &a("mx1"), &mut f, NOW, "x".into(), NOW),
            Err(CoreError::WrongState)
        );
    }
    #[test]
    fn settle_excluded_rejected() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        exclude(&mut po, &a("mx1"), &mut f).unwrap();
        assert_eq!(
            settle(&p(), &mut po, &a("mx1"), &mut f, NOW, "x".into(), NOW),
            Err(CoreError::WrongState)
        );
    }

    // ---------- exclude ----------
    #[test]
    fn exclude_releases_exposure_no_penalty() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        exclude(&mut po, &a("mx1"), &mut f).unwrap();
        assert!(po.excluded);
        assert_eq!(po.state, PayoutState::Assigned);
        assert_eq!(po.firm, Some(a("mx1")));
        assert_eq!(f.open_exposure, 0);
        assert_eq!(f.bond, 1_000_000_000);
        assert_eq!(
            exclude(&mut po, &a("mx1"), &mut f),
            Err(CoreError::WrongState)
        );
    }
    #[test]
    fn exclude_wrong_firm_rejected() {
        let (mut f, mut g) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        assert_eq!(
            exclude(&mut po, &a("mx2"), &mut g),
            Err(CoreError::WrongFirm)
        );
    }

    // ---------- refund ----------
    #[test]
    fn refund_before_deadline_rejected() {
        let mut po = funded(1_000_000);
        let dl = po.final_deadline_ns;
        assert_eq!(
            refund(&p(), &mut po, None, dl),
            Err(CoreError::NotRefundableYet)
        );
    }
    #[test]
    fn refund_after_deadline_funded() {
        let mut po = funded(1_000_000);
        let dl = po.final_deadline_ns;
        let o = refund(&p(), &mut po, None, dl + 1).unwrap();
        assert_eq!(
            o,
            Outcome {
                pay_firm: 0,
                pay_funder: 1_002_500,
                penalty: 0,
                periods: 0
            }
        );
        assert_eq!(po.state, PayoutState::Refunded);
    }
    #[test]
    fn refund_after_deadline_assigned_charges_firm() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000_000, "mx1", &mut f, 20);
        let t = po.final_deadline_ns + 1; // 540 s + 1 ns past cutoff -> 55 periods
        let o = refund(&p(), &mut po, Some(&mut f), t).unwrap();
        assert_eq!(o.periods, 55);
        assert_eq!(o.penalty, 5_500_000);
        assert_eq!(o.pay_funder, 1_002_500_000 + 5_500_000);
        assert_eq!(f.open_exposure, 0);
        assert_eq!(f.bond, 1_000_000_000 - 5_500_000);
    }
    #[test]
    fn refund_assigned_without_firm_rejected() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        let t = po.final_deadline_ns + 1;
        assert_eq!(refund(&p(), &mut po, None, t), Err(CoreError::WrongFirm));
    }
    #[test]
    fn refund_excluded_immediately_no_penalty() {
        let mut f = firm(1_000_000_000);
        let mut po = assigned(1_000_000, "mx1", &mut f, 20);
        exclude(&mut po, &a("mx1"), &mut f).unwrap();
        let o = refund(&p(), &mut po, None, NOW).unwrap();
        assert_eq!(
            o,
            Outcome {
                pay_firm: 0,
                pay_funder: 1_002_500,
                penalty: 0,
                periods: 0
            }
        );
        assert_eq!(f.bond, 1_000_000_000);
    }
    #[test]
    fn refund_twice_rejected() {
        let mut po = funded(1_000_000);
        let t = po.final_deadline_ns + 1;
        refund(&p(), &mut po, None, t).unwrap();
        assert_eq!(refund(&p(), &mut po, None, t), Err(CoreError::WrongState));
    }

    // ---------- bonds ----------
    #[test]
    fn withdraw_bond_respects_exposure() {
        let mut f = firm(2_000_000);
        let _po = assigned(20_000_000, "mx1", &mut f, 20);
        assert!(withdraw_bond(&p(), &mut f, 1_000_000).is_ok());
        assert_eq!(f.bond, 1_000_000);
        assert_eq!(withdraw_bond(&p(), &mut f, 1), Err(CoreError::BondTooLow));
        let mut g = firm(5);
        assert_eq!(withdraw_bond(&p(), &mut g, 6), Err(CoreError::BondTooLow));
        post_bond(&mut g, 10);
        assert_eq!(g.bond, 15);
    }
    #[test]
    fn penalty_capped_by_bond_then_firm_unassignable() {
        let (mut mx3, mut mx2) = (firm(1_000_000_000), firm(1_000_000_000));
        let mut po = assigned(1_000_000_000, "mx3", &mut mx3, 18);
        mx3.bond = 5; // drained by earlier penalties
        let t = po.cutoff_ns + 50 * P; // inside the 600 s deadline
        let o = reroute(&p(), &mut po, &mut mx3, &a("mx2"), &mut mx2, 20, t).unwrap();
        assert_eq!(o.penalty, 5);
        assert_eq!(mx3.bond, 0);
        let mut next = funded(1_000_000);
        assert_eq!(
            assign(&p(), &mut next, &a("mx3"), &mut mx3, 18, NOW),
            Err(CoreError::ExposureExceeded)
        );
    }
}
