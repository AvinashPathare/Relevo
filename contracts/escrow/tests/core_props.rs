//! Property tests: the five invariants from the design (§7) over random operation sequences.
use elivo_escrow::logic::engine::*;
use elivo_escrow::logic::math::{demo_params, fee_for, locked_for};
use elivo_escrow::logic::types::*;
use near_sdk::AccountId;
use proptest::prelude::*;

const S: u64 = 1_000_000_000;

#[derive(Clone, Debug)]
enum Op {
    Fund {
        amounts: Vec<u128>,
        cut_s: u64,
        extra_s: u64,
    },
    PostBond {
        firm: usize,
        amount: u128,
    },
    Assign {
        payout: usize,
        firm: usize,
        bps: u16,
    },
    Reroute {
        payout: usize,
        firm: usize,
        bps: u16,
    },
    Settle {
        payout: usize,
        firm: usize,
        back_s: u64,
    },
    Exclude {
        payout: usize,
        firm: usize,
    },
    Refund {
        payout: usize,
    },
    WithdrawBond {
        firm: usize,
        amount: u128,
    },
    Advance {
        ns: u64,
    },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        // weights favour reaching deep states (assigned, late, past the 2% cap)
        2 => (
            prop::collection::vec(1_000_000u128..=5_000_000_000, 1..=5),
            1u64..300,
            1u64..600
        )
            .prop_map(|(amounts, cut_s, extra_s)| Op::Fund {
                amounts,
                cut_s,
                extra_s
            }),
        3 => (0usize..3, 0u128..=2_000_000_000).prop_map(|(firm, amount)| Op::PostBond { firm, amount }),
        4 => (0usize..15, 0usize..3, 0u16..=30).prop_map(|(payout, firm, bps)| Op::Assign {
            payout,
            firm,
            bps
        }),
        3 => (0usize..15, 0usize..3, 0u16..=30).prop_map(|(payout, firm, bps)| Op::Reroute {
            payout,
            firm,
            bps
        }),
        3 => (0usize..15, 0usize..3, 0u64..120).prop_map(|(payout, firm, back_s)| Op::Settle {
            payout,
            firm,
            back_s
        }),
        1 => (0usize..15, 0usize..3).prop_map(|(payout, firm)| Op::Exclude { payout, firm }),
        3 => (0usize..15).prop_map(|payout| Op::Refund { payout }),
        1 => (0usize..3, 0u128..=2_000_000_000)
            .prop_map(|(firm, amount)| Op::WithdrawBond { firm, amount }),
        3 => prop_oneof![0u64..=60 * S, 0u64..=3_000 * S].prop_map(|ns| Op::Advance { ns }),
    ]
}

#[derive(Default)]
struct Model {
    now: u64,
    firm_ids: Vec<AccountId>,
    firms: Vec<Firm>,
    payouts: Vec<Payout>,
    paid: Vec<u32>,
    first_terminal: Vec<Option<PayoutState>>,
    escrow: u128,
    funder_received: u128,
    funder_penalty_received: u128,
    firm_received: u128,
    owner_received: u128,
    penalties_charged: u128,
    bad_destination: bool,
}

impl Model {
    fn new() -> Self {
        let ids: Vec<AccountId> = ["mx1", "mx2", "mx3"]
            .iter()
            .map(|s| s.parse().unwrap())
            .collect();
        Model {
            now: 1_000_000 * S,
            firms: ids
                .iter()
                .map(|_| Firm {
                    approved: true,
                    ..Default::default()
                })
                .collect(),
            firm_ids: ids,
            ..Default::default()
        }
    }

    fn pay_funder(&mut self, o: &Outcome) {
        self.escrow = self
            .escrow
            .checked_sub(o.pay_funder)
            .expect("escrow underflow (funder)");
        self.funder_received += o.pay_funder;
        self.funder_penalty_received += o.penalty;
        self.penalties_charged += o.penalty;
    }

    fn apply(&mut self, op: &Op) {
        let p = demo_params();
        let now = self.now;
        match op.clone() {
            Op::Fund {
                amounts,
                cut_s,
                extra_s,
            } => {
                if self.payouts.len() + amounts.len() > 15 {
                    return;
                }
                let items: Vec<PayoutIn> = amounts
                    .iter()
                    .enumerate()
                    .map(|(i, &amount)| PayoutIn {
                        id: i as u32,
                        amount,
                        cutoff_in_ns: cut_s * S,
                        deadline_in_ns: (cut_s + extra_s) * S,
                    })
                    .collect();
                let total: u128 = amounts.iter().map(|&a| locked_for(&p, a)).sum();
                let v = new_payouts(&p, &items, total, now).expect("valid batch");
                self.escrow += total;
                for po in v {
                    self.payouts.push(po);
                    self.paid.push(0);
                    self.first_terminal.push(None);
                }
            }
            Op::PostBond { firm, amount } => {
                post_bond(&mut self.firms[firm], amount);
                self.escrow += amount;
            }
            Op::WithdrawBond { firm, amount } => {
                let before = self.firms[firm].clone();
                match withdraw_bond(&p, &mut self.firms[firm], amount) {
                    Ok(()) => {
                        self.escrow = self
                            .escrow
                            .checked_sub(amount)
                            .expect("escrow underflow (bond)")
                    }
                    Err(_) => assert_eq!(before, self.firms[firm], "Err mutated firm"),
                }
            }
            Op::Advance { ns } => self.now += ns,
            Op::Assign { payout, firm, bps } => {
                let Some(po) = self.payouts.get(payout).cloned() else {
                    return;
                };
                let (mut po2, mut f2) = (po.clone(), self.firms[firm].clone());
                match assign(&p, &mut po2, &self.firm_ids[firm], &mut f2, bps, now) {
                    Ok(()) => {
                        self.payouts[payout] = po2;
                        self.firms[firm] = f2;
                    }
                    Err(_) => assert!(po2 == po && f2 == self.firms[firm], "Err mutated"),
                }
            }
            Op::Reroute { payout, firm, bps } => {
                let Some(po) = self.payouts.get(payout).cloned() else {
                    return;
                };
                let Some(old_id) = po.firm.clone() else {
                    return;
                };
                let old_idx = self.firm_ids.iter().position(|x| *x == old_id).unwrap();
                if old_idx == firm {
                    return; // one record can't be borrowed twice; the engine rejects via firms_tried anyway
                }
                let (mut po2, mut old, mut new) = (
                    po.clone(),
                    self.firms[old_idx].clone(),
                    self.firms[firm].clone(),
                );
                match reroute(
                    &p,
                    &mut po2,
                    &mut old,
                    &self.firm_ids[firm],
                    &mut new,
                    bps,
                    now,
                ) {
                    Ok(o) => {
                        assert_eq!(o.pay_firm, 0);
                        self.payouts[payout] = po2;
                        self.firms[old_idx] = old;
                        self.firms[firm] = new;
                        self.pay_funder(&o);
                    }
                    Err(_) => assert!(
                        po2 == po && old == self.firms[old_idx] && new == self.firms[firm],
                        "Err mutated"
                    ),
                }
            }
            Op::Settle {
                payout,
                firm,
                back_s,
            } => {
                let Some(po) = self.payouts.get(payout).cloned() else {
                    return;
                };
                let at = now.saturating_sub(back_s * S);
                let (mut po2, mut f2) = (po.clone(), self.firms[firm].clone());
                match settle(
                    &p,
                    &mut po2,
                    &self.firm_ids[firm],
                    &mut f2,
                    at,
                    "CEP".into(),
                    now,
                ) {
                    Ok(o) => {
                        if po.firm.as_ref() != Some(&self.firm_ids[firm]) {
                            self.bad_destination = true;
                        }
                        self.payouts[payout] = po2;
                        self.firms[firm] = f2;
                        self.escrow = self
                            .escrow
                            .checked_sub(o.pay_firm)
                            .expect("escrow underflow (firm)");
                        self.firm_received += o.pay_firm;
                        self.pay_funder(&o);
                        self.paid[payout] += 1;
                    }
                    Err(_) => assert!(po2 == po && f2 == self.firms[firm], "Err mutated"),
                }
            }
            Op::Exclude { payout, firm } => {
                let Some(po) = self.payouts.get(payout).cloned() else {
                    return;
                };
                let (mut po2, mut f2) = (po.clone(), self.firms[firm].clone());
                match exclude(&mut po2, &self.firm_ids[firm], &mut f2) {
                    Ok(()) => {
                        self.payouts[payout] = po2;
                        self.firms[firm] = f2;
                    }
                    Err(_) => assert!(po2 == po && f2 == self.firms[firm], "Err mutated"),
                }
            }
            Op::Refund { payout } => {
                let Some(po) = self.payouts.get(payout).cloned() else {
                    return;
                };
                let idx = po
                    .firm
                    .as_ref()
                    .and_then(|id| self.firm_ids.iter().position(|x| x == id));
                let mut po2 = po.clone();
                let mut f2 = idx.map(|i| self.firms[i].clone());
                match refund(&p, &mut po2, f2.as_mut(), now) {
                    Ok(o) => {
                        self.payouts[payout] = po2;
                        if let (Some(i), Some(f)) = (idx, f2) {
                            self.firms[i] = f;
                        }
                        self.pay_funder(&o);
                        self.paid[payout] += 1;
                    }
                    Err(_) => assert_eq!(po2, po, "Err mutated payout"),
                }
            }
        }
        for (i, po) in self.payouts.iter().enumerate() {
            if po.state.is_terminal() {
                match self.first_terminal[i] {
                    None => self.first_terminal[i] = Some(po.state),
                    Some(s) => assert_eq!(s, po.state, "terminal state changed"),
                }
            }
        }
    }
}

fn run(ops: &[Op], check: impl Fn(&Model)) {
    let mut m = Model::new();
    for op in ops {
        m.apply(op);
        check(&m);
    }
}

fn ops() -> impl Strategy<Value = Vec<Op>> {
    prop::collection::vec(op(), 1..60)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn inv1_escrow_balance(ops in ops()) {
        run(&ops, |m| {
            let open: u128 = m.payouts.iter().filter(|p| !p.state.is_terminal()).map(|p| p.locked).sum();
            let bonds: u128 = m.firms.iter().map(|f| f.bond).sum();
            assert_eq!(m.escrow, open + bonds);
        });
    }

    #[test]
    fn inv2_single_terminal_payout(ops in ops()) {
        run(&ops, |m| {
            for (i, po) in m.payouts.iter().enumerate() {
                assert!(m.paid[i] <= 1);
                assert_eq!(m.paid[i] == 1, po.state.is_terminal());
            }
        });
    }

    #[test]
    fn inv3_penalty_bounds(ops in ops()) {
        run(&ops, |m| {
            for po in &m.payouts {
                assert!(po.penalties_total <= fee_for(po.amount, 200));
            }
        });
    }

    #[test]
    fn inv4_penalties_to_funder(ops in ops()) {
        run(&ops, |m| {
            assert_eq!(m.owner_received, 0);
            assert_eq!(m.penalties_charged, m.funder_penalty_received);
            let paid_by_firms: u128 = m.firms.iter().map(|f| f.penalties_paid).sum();
            assert_eq!(paid_by_firms, m.penalties_charged);
            let on_payouts: u128 = m.payouts.iter().map(|p| p.penalties_total).sum();
            assert_eq!(on_payouts, m.penalties_charged);
        });
    }

    #[test]
    fn inv5_no_arbitrary_destination(ops in ops()) {
        run(&ops, |m| {
            assert!(!m.bad_destination);
            let delivered_value: u128 = m.payouts.iter()
                .filter(|p| p.state == PayoutState::Delivered)
                .map(|p| p.amount + fee_for(p.amount, p.quote_bps))
                .sum();
            assert_eq!(m.firm_received, delivered_value);
        });
    }
}
