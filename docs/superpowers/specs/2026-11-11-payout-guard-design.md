# Elivo Payout Guard — Design

Date: 2026-11-11 · Status: approved 2026-11-11 · Deadline: 2026-11-14 23:59 UTC (internal submit 19:00 UTC)

> Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.

## 1. Intent

A DAO votes once to pay a batch of contributors in Mexico. The USDC locks in a NEAR escrow
contract. Bonded payout firms quote to deliver each payout in MXN. A signed delivery proof is
the only thing that releases money. If a firm misses its cut-off, the router reroutes the
payout to another firm and the late firm's bond pays a penalty to the DAO. If nobody delivers
by the final deadline, anyone can trigger a full refund to the DAO. Every step ends up in a
signed batch receipt.

**The one thing judges must see:** a firm fails, the payout is rerouted within seconds, the
bond pays the penalty, and a signed receipt proves it.

**What decides success:** the repo runs from a fresh clone and does exactly what its README
says. Hackathon AI screening (Claude Code / Codex) checks this, then human judges watch a
3-minute video.

## 2. Goals, non-goals, anti-goals

**Goals (P0, all must ship):** F1–F13 from the PRD, restated with acceptance tests in §9, plus
**F15a** (promoted from P1 by the founder on 11 Nov): the oracle can post a signed exclusion
with reason `ACCOUNT_CLOSED` for an assigned payout. The payout is then marked excluded, never
rerouted, carries no penalty, and is refunded in full. The full F15 reason-code list (bank
outage, rejection, wrong details) stays P1.

**P1 (only if P0 is green by Fri 13 Nov 12:00 UTC):** F14 1Click pay-in quote, F15 signed
exclusions, F16 firm scoreboard, F17 pause switch. *Builder's note: F17 is cheap in the
contract and is scheduled with the contract on day 1; its UI is P1.*

**Non-goals:** real MXN, real SPEI or CEP lookups, KYB/KYT/sanctions, custody, mainnet escrow,
multi-tenancy, any token, AI agents, a production ledger.

**Anti-goals (a failure even if it "works"):**
- A README claim the code doesn't back up.
- Any path that lets the router, oracle or owner move escrowed funds to an arbitrary account.
- Payee names or full CLABEs in any transaction, event or log on-chain.
- A demo that looks like a live money service: the testnet/simulation label is on every screen.
- Business plan content, customer names or real firm names in the public repo.

## 3. Constraints

- Public repo, new code only, Apache-2.0 licence, committed before any code.
- One command each for setup, demo and tests. CI runs build, lint and all tests on every push.
- The demo must run with no paid keys and no secrets in the repo.
- Stack (PRD): Rust + near-sdk contract, near-workspaces sandbox tests, TypeScript/Node router
  with near-api-js, Next.js + NEAR Wallet Selector web app.
- Sputnik DAO on testnet is v2.3.x from factory `sputnikv2.testnet` (verified 11 Nov). Its
  `act_proposal` takes `{ id, action, proposal }`, where `proposal` is the proposal kind and
  must match the stored proposal. Pass it.

## 4. Decisions settled with the founder (11 Nov)

These close gaps in the PRD. They are agreed.

1. **When the penalty is charged.** The router reroutes only after a grace window past the
   cut-off (10 s in demo mode, 5 min in real-time mode). On `reroute`, the late firm is charged
   for every period since its cut-off, rounded up, with a minimum of one period. The same
   charge applies on `refund` if a firm was assigned and never delivered. A firm that delivers
   after its cut-off but before being rerouted is charged the same way at `settle`.
2. **Who pays the firm's fee.** The DAO funds each payout as `amount + amount × max_fee_bps /
   10_000` (max fee 25 bps). On settlement the firm gets `amount + amount × quote_bps / 10_000`
   and the unused part of the fee buffer goes back to the DAO. On refund the DAO gets the whole
   locked sum back.
3. **Quote signatures.** Each firm registers an ed25519 public key with the escrow. The
   contract verifies every `quote_sig` against that key.
7a. **Closed accounts are excluded, not penalised (F15a, P0).** `exclude(batch, payout,
   exclusion, oracle_sig)`, router-submitted and oracle-signed over
   `borsh(("elivo-exclusion-v1", escrow_account_id, Exclusion { batch_id, payout_id, firm_id,
   reason_code, observed_at_ns, nonce }))`. It is valid only while the payout is `Assigned` to
   that firm. It sets `excluded = true`, releases the firm's exposure with no penalty, and blocks
   `reroute`. An excluded payout may be refunded immediately (not only after the final
   deadline), with no penalty. Event: `payout_excluded`.
4. **Backup firm also late.** It gets rerouted again, each late firm pays its own penalty, and
   the 2% cap applies to the total of penalties on that payout.
5. **Funding through Sputnik.** The proposal is a `FunctionCall` on the USDC contract that calls
   `ft_transfer_call` into the escrow. The escrow sees the DAO as `sender_id` and records it as
   the batch's funder. Refunds, fee leftovers and penalties all go to the funder.
6. **Licence:** Apache-2.0.

## 5. Calls made by the designer (not yet reviewed by the founder)

7. **Cut-offs are relative, not absolute.** The funding message carries `cutoff_in_ns` and
   `deadline_in_ns`, and the contract adds them to the block time when the batch is funded. With
   absolute times, a vote taken later than expected could arrive after the cut-off. *Changes the
   PRD's `fund_batch` message shape.*
8. **Two demo targets.** `make demo` runs the whole flow on a local NEAR sandbox: no accounts,
   no keys, no network apart from first-time downloads. That is what fresh-clone checks and CI
   use. `make demo-testnet` deploys a fresh instance on testnet with faucet-created accounts and
   runs the same flow. That run produces the video and the contract addresses in the README. The
   router, simulators and web app are identical across both targets; only the RPC URL and the
   account names change.
9. **Prebuilt wasm is committed** (`contracts/res/*.wasm`, rebuilt and checked by CI). The demo
   does not need Rust; the contract tests do.
10. **The Sputnik DAO wasm is fetched at setup, not committed.** `pnpm setup` downloads it from
    a testnet DAO with RPC `view_code`, checks it against a pinned code hash and caches it under
    `.cache/`. The sandbox demo can then deploy a real Sputnik DAO without third-party binaries
    in the repo. Setup already needs network for the sandbox binary, so the "no keys, no
    accounts" claim holds and "no network" is never claimed.
11. **Failed outgoing transfers go to a claims ledger.** If an `ft_transfer` from the escrow
    fails, the callback credits `claimable[account]` and `claim()` retries later. Payout state
    never rolls back after a valid proof (first valid proof wins). This is how the "callback
    restores state" requirement is met.
12. **Storage is prepaid.** The escrow keeps a NEAR storage credit per account
    (`storage_deposit(account_id?)`, which anyone may call for anyone). Funding measures the
    storage the batch used and debits the funder's credit. If the credit is short, the whole
    token amount is returned. The setup scripts prepay for the DAO.
13. **Signatures are domain-separated.** The oracle signs
    `borsh(("elivo-proof-v1", escrow_account_id, DeliveryProof))`. Firms sign
    `borsh(("elivo-quote-v1", escrow_account_id, Quote))`.
14. **Batch hash is salted.** `batch_hash = sha256(canonical JSON of rows + 32-byte random
    salt)`. The salt stays in the router's local store, so on-chain hashes can't be
    brute-forced back to CLABEs.
15. **FX is fixed and simulated.** `MXN_PER_USDC` comes from config, default 18.50. On-chain
    amounts are USDC in 6-decimal base units.
16. **The demo outcome is deterministic.** Sample data has five payees. MX-1 and MX-2 are in
    `ok` mode and MX-3 is in `late` mode. MX-3 quotes cheapest, so it wins first. One payee's
    CLABE is valid but on the simulators' *closed-account* list. The assigned firm reports it,
    the oracle signs an `ACCOUNT_CLOSED` exclusion, and the payout is refunded in full with no
    penalty to anyone. The run must always produce at least one on-time delivery by MX-1 or
    MX-2, at least one reroute away from MX-3 with a penalty, and exactly one refund.
17. **Pause also blocks `reroute`**, since a reroute is an assignment. `settle`, `refund`,
    `claim` and `withdraw_bond` always work.
18. **No single key can drain escrow.**
    - When a batch is funded, the escrow copies `router_id`, `oracle_pk` and `receipt_pk` into
      it. Rotating keys later changes only new batches.
    - Firms must be approved by the owner (`approve_firm` / `revoke_firm`) before they can be
      assigned. `register_firm` only stores the key.
    - Taking a payout therefore needs three parties together: an approved firm, the router and
      the oracle. The owner alone, the router alone and the oracle alone can't do it.
    - The README states the remaining trust plainly: the oracle and router are trusted, and
      production adds a custodian-held second release key.
    - The owner is the deployer account. Making the DAO the owner is post-hackathon.
19. **The receipt public key is on-chain.** `receipt_pk` is in config and in each batch's
    snapshot. `verify-receipt` takes the public key from the chain (`--chain`) or from
    `--pubkey`. It never trusts a key embedded in the file.
20. **What the AI screener needs.** `make demo` needs only Node 20+, pnpm and network for
    first-time downloads. `make test` also needs Rust; `pnpm setup` checks for it and prints
    exact install commands if it's missing. The Saturday fresh-clone check runs both commands in
    a clean `node:22` + rustup Docker image.

## 6. Architecture

```
web (Next.js) ──▶ router API ──▶ escrow contract ◀── USDC (NEP-141 mock)
     │                 │  ▲            ▲
     │ wallet          │  │ proofs     │ ft_transfer_call (proposal execution)
     ▼                 ▼  │            │
 Sputnik DAO ──────────────┴──── Sputnik DAO (council votes)
                firm sims MX-1..3 ──▶ proof oracle (simulated CEP)
```

Only the escrow contract holds funds. The router can assign, reroute, settle and anchor
receipts, but it cannot withdraw.

### Repo layout (pnpm workspace + cargo workspace)

```
contracts/escrow        Rust, near-sdk 5.x: escrow, bond vault, receipt registry
contracts/mock-usdc     Rust NEP-141, 6 decimals, owner mint (testnet stand-in)
contracts/res           committed release wasm
contracts/tests         near-workspaces integration tests (Rust)
packages/clabe          CLABE parse/validate (TS)
packages/receipt        canonical JSON (RFC 8785), ed25519 sign/verify, `verify-receipt` CLI
packages/near           shared chain client: config, accounts, view/call helpers, event parser
apps/router             HTTP API, quote collection, assignment, reroute loop, receipts
apps/firm-sim           one binary run three times (MX-1/2/3), modes ok|late|fail
apps/oracle             signs DeliveryProofs (simulated CEP)
apps/web                Next.js app
scripts/                setup, deploy, demo orchestration (sandbox + testnet)
vendor/                 sputnikdao2.wasm + LICENSE/SOURCE note
```

## 7. Contract: `elivo-escrow`

### Config (owner-set; view `get_config`)

`owner_id, token_id, router_id, oracle_pk: [u8;32], period_ns (demo 10 s, real 1 h),
penalty_bps_per_period = 1, cap_bps = 200, max_fee_bps = 25, exposure_multiple = 20,
reroute_window_ns (new cut-off given to a backup firm), min_payout = 1 USDC, max_batch = 50,
paused`.

The owner may change `router_id`, `oracle_pk`, `paused` and the timing parameters. The owner
may never move funds or block `settle`, `refund` or `claim`.

### State

- `Batch { id, funder, batch_hash, funded_at_ns, payout_count, receipt_hash: Option }`
- `Payout { amount, locked (amount + max fee), state: Funded|Assigned|Delivered|Refunded,
  firm: Option, quote_bps, cutoff_ns, final_deadline_ns, penalties_total, firms_tried: Vec,
  delivered_at_ns, proof_ref }`
- `Firm { pk, bond, open_exposure, delivered_on_time, delivered_late, penalties_paid, volume }`
- `used_nonces: LookupSet<u64>`, `claimable: LookupMap<AccountId, u128>`,
  `storage_credit: LookupMap<AccountId, u128>`

### Methods

| Method | Who | Rules |
|---|---|---|
| `ft_on_transfer(sender, amount, msg)` | token contract only | `fund_batch` or `post_bond`; anything invalid returns the full amount |
| `register_firm(pk)` | firm, attaches storage | one key per firm; re-registering rotates the key |
| `assign(batch, payout, firm, quote_bps, quote_sig)` | router | payout `Funded`; firm registered; `quote_bps ≤ max_fee_bps`; valid quote sig; `open_exposure + amount ≤ bond × multiple`; not paused |
| `reroute(batch, payout, new_firm, quote_bps, quote_sig)` | router | payout `Assigned`; `now > cutoff`; `new_firm` not in `firms_tried`; charge the late firm (§7 penalty); new cut-off = `min(now + reroute_window, final_deadline)`; same checks as `assign` |
| `settle(batch, payout, proof, oracle_sig)` | router | payout `Assigned`; `proof.firm_id` = current firm; ids match; nonce unused; valid oracle sig; `delivered_at ≤ now`; if `delivered_at > cutoff`, charge a penalty; pay firm `amount + fee`, pay leftover fee to funder |
| `exclude(batch, payout, exclusion, oracle_sig)` | router | see decision 7a |
| `refund(batch, payout)` | anyone | `now > final_deadline` or payout excluded; payout `Funded` or `Assigned`; if assigned, charge that firm; pay `locked` to funder; works while paused |
| `anchor_receipt(batch, hash)` | router | once per batch, all payouts terminal |
| `withdraw_bond(amount)` | firm | remaining `bond × multiple ≥ open_exposure` |
| `claim()` | anyone with a claim | retries the failed transfer |
| `storage_deposit(account_id?)` / `set_config` / `set_paused` | anyone / owner / owner | |
| views | anyone | `get_batch`, `get_payout`, `get_batch_payouts`, `get_firm`, `get_config`, `get_claimable` |

`fund_batch` message:
`{ "kind": "fund_batch", "batch_hash": "<hex32>", "router_id": "<account>", "oracle_pk":
"ed25519:<b58>", "payouts": [{ "id": 0, "amount": "<u128>", "cutoff_in_ns": "<u64>", "deadline_in_ns":
"<u64>" }] }`. `router_id` and `oracle_pk` must equal the live config (else `config_mismatch`, full
refund), so a config change made between a DAO vote and its execution cannot capture the batch.
`deadline_in_ns` is at most 30 days. A first `storage_deposit` for an account must be at least 0.01 NEAR. Ids run `0..n-1` and `n ≤ 50`.
Each `amount ≥ min_payout`, `0 < cutoff_in < deadline_in`, and the transferred total must equal
`Σ locked` exactly.

### Penalty rule (pure function, property-tested)

```
periods(t, cutoff) = t > cutoff ? max(1, ceil((t - cutoff) / period_ns)) : 0
penalty = min(amount × periods × penalty_bps_per_period / 10_000,
              amount × cap_bps / 10_000 − payout.penalties_total,
              firm.bond)
```

The penalty is debited from the firm's bond and sent 100% to the funder. The owner's account
never receives anything.

### Events (NEP-297, standard `elivo`, version `1.0.0`)

`batch_funded, bond_posted, firm_registered, payout_assigned (incl. quote_bps),
payout_rerouted, payout_delivered, penalty_charged, payout_refunded, receipt_anchored,
transfer_failed, claimed`. Events carry only ids, amounts, hashes and account ids.

### Invariants (property tests over random operation sequences)

1. `token balance of escrow = Σ locked of non-terminal payouts + Σ bonds + Σ claimable`
   (the PRD's escrow invariant, widened to include bonds and claims, which share the contract).
2. Every payout ends in exactly one terminal state and pays out at most once.
3. Penalties on a payout never exceed 2% of its amount. A bond never goes below zero.
4. All penalties go to the funder. The owner and router receive nothing.
5. No sequence of router, oracle or owner calls sends escrowed funds anywhere except the
   assigned firm (on a valid proof) or the funder.

Implementation note: the state machine and money math live in a pure Rust module with no
`env` calls. proptest drives that module, and thin `#[near]` wrappers call it, so property
tests run fast and the sandbox tests cover the wiring.

## 8. Off-chain services

**Router API** (Fastify):
- `POST /batches/validate` takes a CSV and returns row errors, CLABE results, the batch hash
  and the USDC total.
- `POST /batches/:id/proposal` returns `add_proposal` args, plus the `storage_deposit` and USDC
  storage-registration steps, for the wallet or script to sign.
- `GET /batches/:id` returns batch and payout states merged from contract views and events,
  with explorer links.
- `GET /batches/:id/receipt` returns the signed receipt JSON.
- `GET /quote/payin?asset=` proxies 1Click (P1).
- `POST /sim/firms/:id/mode` sets a firm's mode.

The local store is a JSON file under `.data/` (gitignored). It holds payee names, CLABEs and
salts.

**Router loop:** watches for `batch_funded`. For each payout it requests signed quotes from all
firms, filters by exposure (`get_firm`) and `firms_tried`, assigns the cheapest, and sends the
order to that firm. When a cut-off plus grace has passed with no proof, it reroutes to the next
cheapest eligible firm. If no firm is eligible, the payout waits for refund, and the router
calls `refund` itself after the deadline (anyone may). Proofs from the oracle are submitted with
`settle`. When every payout is terminal, it builds the receipt, signs it and anchors the hash.
The router account uses a function-call access key limited to the escrow and the methods
`assign, reroute, settle, anchor_receipt, refund`.

**Firm sims:** `POST /quote` returns a signed quote in the 18–25 bps range (MX-3 18, MX-2 20,
MX-1 22). `POST /orders` accepts an order.
- `ok`: delivers after 2–4 s.
- `late`: delivers after cut-off plus grace, so it always loses the race to a reroute.
- `fail`: never delivers.
- Closed-account CLABEs are never delivered, whatever the mode. The firm reports them to the
  oracle as `ACCOUNT_CLOSED`, and the router submits the signed exclusion and then the refund.

On delivery the firm asks the oracle for a proof.

**Oracle:** checks that the order exists (asks the router), then signs a `DeliveryProof
{ batch_id, payout_id, firm_id, delivered_at_ns, proof_ref: "CEP-SIM-…", nonce }`. It has no
account and calls no contract.

**Receipt:** canonical JSON containing the batch id, hash, escrow and network. Each payout entry
has id, amount, a per-payee reference (`sha256(salt‖clabe)`), the firms tried, assign, cut-off
and delivery times, proof ref, oracle signature, penalties, final state and tx hashes. Signed
ed25519 by a separate receipt key. `verify-receipt <file> [--chain]` prints OK or FAIL. With
`--chain`, it also checks the anchored hash.

**Web app:** a testnet label banner on every page, and four screens:
- Upload & validate
- Quote (totals, fee buffer, deadlines, pay-in quote)
- Propose & vote (Wallet Selector: create proposal, approve)
- Live status (polling, explorer links, receipt download)

In sandbox mode wallet signing is replaced by a "demo signer" toggle that uses local keys,
clearly labelled.

## 9. Acceptance tests (what "done" means)

| ID | Test |
|---|---|
| F1 | CSV of up to 50 rows parses; malformed rows (missing field, bad amount, >50 rows) come back with reasons |
| F2 | Known valid and invalid CLABE vectors; one bad row blocks the batch |
| F3 | Sandbox test scans every tx arg and event of a full run for payee names and CLABEs: none found |
| F4 | Wrong token, wrong total, malformed msg: full amount returned |
| F5 | Sandbox: batch exists only after the Sputnik proposal is approved; a rejected proposal funds nothing |
| F6 | Assignment over `bond × 20` rejected; `withdraw_bond` below requirement rejected |
| F7 | Router picks the lowest eligible quote (unit); `payout_assigned` event has the winning quote (sandbox) |
| F8 | Bad signature, other payout's proof, reused nonce, wrong firm: all rejected |
| F9 | Property test on penalty bounds and destination; sandbox: DAO balance rises by the penalty |
| F10 | Router timing test: reroute fires within grace + one poll (≤10 s demo, ≤5 min real) |
| F11 | `refund` before deadline fails, after deadline succeeds from an unrelated account, and works while paused |
| F12 | `verify-receipt` returns OK on a real receipt and FAIL after any one-field edit |
| F13 | Status page state equals contract views after reload (web test against sandbox) |
| F15a | Signed exclusion: payout excluded, firm charged nothing, reroute rejected, refund allowed at once; bad sig / wrong firm / reused nonce rejected |
| F17 | Paused contract rejects fund/assign/reroute, still settles and refunds |

Integration scenarios (near-workspaces): happy path, late with reroute, refund, bond
exhaustion, paused contract, double settlement after reroute.

## 10. Commands (README must match; updated 12 Nov with Plan 3)

```
make setup                       # pnpm install, Sputnik wasm (hash-checked), local keys
make demo                        # full flow on local sandbox, prints receipt + verify result
make demo-testnet                # same on testnet (needs the deployer's keys)
make test                        # cargo test (unit + proptest + workspaces) + vitest
pnpm dev                         # web app + router + sims against sandbox (demo signer)
pnpm dev:testnet                 # same against testnet (MyNearWallet; needs the deployer's keys)
pnpm web:testnet                 # read-only web app against testnet: /chain/<id>, /firms
```

## 11. Build order and cut lines

- **Wed:** licence, CI, mock USDC, escrow core + unit/property tests, sandbox tests, testnet deploy.
- **Thu:** router, sims, oracle, receipts, CLABE, `make demo` on sandbox and testnet.
- **Fri:** web app, Sputnik UI flow, 1Click. Freeze 22:00 UTC.
- **Sat:** fresh-clone check in Docker, README, video, submit.

Cut lines (from the PRD):

| If this is true | Cut this | Keep |
|---|---|---|
| Contract tests not green by Thu 09:00 | full F15 list (F15a stays), F16, F17 and the refund-with-penalty variant | assign, settle, penalty, reroute, plain refund |
| `make demo` not working by Fri 09:00 | web upload and quote screens; ship a read-only status page | CLI demo, Sputnik proposal created by script |
| Sputnik flow not working by Fri 18:00 | Social Money track; fund from a plain account | Real-World Money entry |
| 1Click quote not working by Fri 20:00 | F14; README describes it as planned, not done | everything else |

**Never cut:** tests, the reroute in the demo, README accuracy.

P1 items in full (from the PRD):
- **F14** pay-in quote for at least one non-NEAR asset through 1Click (`GET /v0/tokens`,
  `POST /v0/quote` with `dry: true` at `1click.chaindefuser.com`, quote only). A failure shows
  a clear message instead.
- **F15** excluded causes (bank outage, rejection, wrong details) logged with a reason code and
  no penalty. The oracle posts a signed exclusion.
- **F16** firm scoreboard (on-time rate, penalties paid, volume), recomputed from events.
- **F17** pause switch.

The PRD's original funding message used absolute `cutoff_ns` and `final_deadline_ns` per payout.
Decision 7 replaces them with relative offsets.

## 12. Left to the builder

Crate and package versions (pin them), HTTP framework details, UI styling (clean and honest,
labels prominent), polling intervals, exact sample payee data (invented names, valid CLABEs plus
one bad one and one closed-account one), explorer URL format, and how scripts create faucet
accounts (near-cli-rs or the faucet helper API).
