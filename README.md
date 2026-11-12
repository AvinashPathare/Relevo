# Elivo Payout Guard

[![CI](https://github.com/AvinashPathare/Relevo/actions/workflows/ci.yml/badge.svg)](https://github.com/AvinashPathare/Relevo/actions/workflows/ci.yml)

> **Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.**
> Not a money transmitter and not a live service.

A DAO votes once to pay a batch of contributors in Mexico. The USDC locks in a NEAR escrow, and bonded payout firms deliver. A late firm is rerouted automatically and its bond pays a penalty to the DAO. Every payout ends in a signed receipt, whose hash is anchored on-chain.

## What is real and what is simulated

| Part | Status |
|---|---|
| Escrow, bond vault and receipt registry (`contracts/escrow`, Rust, near-sdk 5.30) | Real contract, on testnet. Unaudited. |
| Sputnik DAO v2 vote that funds the batch | Real DAO from the official testnet factory (`sputnikv2.testnet`) |
| Router: quotes, assignment, reroute, settle, refund, receipt anchoring (`apps/router`) | Real service. It signs only with a function-call key limited to six escrow methods. |
| Signed receipts and `verify-receipt` | Real ed25519 signatures over RFC 8785 canonical JSON. The hash is anchored on-chain. |
| CSV import with CLABE check-digit validation | Real |
| Web app (`apps/web`, Next.js) | Real. Payout state comes from the escrow's view methods; the router only adds payee names (last 4 digits of the account) and tx links. |
| Pay-in quote from ETH, BTC, SOL or Base USDC | **Real mainnet quote** from the NEAR Intents 1Click API (dry quote), shown for illustration. Nothing is sent. |
| Payout firms MX-1, MX-2, MX-3 (`apps/firm-sim`) | **Simulated.** No MXN moves. MX-3 is configured to be late. |
| Proof oracle and SPEI/CEP references (`apps/oracle`) | **Simulated.** Signs a proof in the shape of a CEP reference. |
| USDC | **Mock** NEP-141 token (`contracts/mock-usdc`, "mUSDC", 6 decimals) |
| MXN/USDC rate | **Fixed** at 18.50 (`MXN_PER_USDC`) |
| Penalty clock | **Demo mode:** one penalty "hour" is 10 seconds. The contract also has a real-time mode (1 hour). |

## Quick start

Requirements: Node 22+ and pnpm 10, on macOS or a Linux with glibc 2.38 or newer (Ubuntu 24.04+, Debian 13+), which the local NEAR sandbox binary needs. `make test` also needs Rust; `rust-toolchain.toml` pins 1.95.0, and you need [cargo-near](https://github.com/near/cargo-near) 0.23.

```bash
make setup   # pnpm install; fetch the Sputnik DAO wasm (hash-checked); generate local keys in .data/
make demo    # full batch on a local NEAR sandbox, about 1 minute; no accounts or keys needed
make test    # contracts (unit, property, sandbox) + TypeScript (lint, typecheck, unit)
pnpm dev     # the web app on a local sandbox: http://localhost:3000/new
```

To look at the testnet reference run without any keys: `pnpm web:testnet`, then open http://localhost:3000/chain/5 and http://localhost:3000/firms.

## Run the demo

`make demo` starts a local NEAR sandbox and deploys mock USDC, the escrow, a Sputnik DAO and three bonded firms. It then runs the oracle, the three firm simulators and the router as separate processes, and drives one batch from start to finish:

1. A CSV with a typo is blocked before the run (`row 5: clabe_check_digit`).
2. `samples/payees.csv` (5 invented payees) validates. Only a salted hash and amounts go on-chain.
3. The router builds a Sputnik `add_proposal`; the council votes once, and the USDC locks in the escrow.
4. Each payout goes to the cheapest eligible bonded firm (bond × 20 limits each firm's open exposure).
5. MX-3 misses its cut-off. Within seconds the router reroutes the payout to the next firm, and MX-3's bond pays 1 bp per period late to the DAO (capped at 2%).
6. One payee's account is closed. The firm reports it, the oracle signs an `ACCOUNT_CLOSED` exclusion, and the payout is refunded in full with no penalty to anyone.
7. Every payout ends Delivered or Refunded. The router signs the batch receipt and anchors its hash.
8. `verify-receipt --chain` prints `OK`, and the same receipt with one number edited prints `FAIL: bad_signature`.

The demo exits non-zero if any of its outcome checks fails. The receipt is written to `.data/receipts/`, and service logs go to `.data/logs/`.

Verify a receipt yourself:

```bash
pnpm verify-receipt .data/receipts/<file>.json --chain --rpc <rpc-url> --escrow <escrow-account>
pnpm verify-receipt .data/receipts/<file>.json --pubkey ed25519:<receipt-key>
```

The public key always comes from the chain (`--chain`) or from you (`--pubkey`), never from the file itself.

**On testnet:** `make demo-testnet` runs the same flow against the deployment below. It needs the deployer's keys in `~/.near-credentials`, so it can only be run by whoever created the deployment. To create your own deployment, run `make deploy-testnet` and then `./scripts/testnet-dao.sh`; both use faucet-funded accounts.

## Web app

`pnpm dev` starts a local sandbox, the router, the oracle and the three firm simulators, then the web app at http://localhost:3000. The screens are:

1. **New batch** (`/new`): upload or paste a CSV, or use a sample. Every CLABE is checked; one bad row blocks the batch.
2. **Quote**: payees with the last 4 digits only, payouts, the 25 bps fee buffer, the total to lock, the fixed rate and the deadlines. Below that is a live 1Click pay-in quote (ETH, BTC, SOL or Base USDC). It is a mainnet price for illustration; 1Click's own app fee is shown.
3. **Propose & vote** (`/batches/<id>`): create the Sputnik DAO proposal, then approve it as the council.
   - On the sandbox, a **demo signer** labelled "Demo signer: local sandbox keys, not a wallet" signs with the local council key. It only signs this app's funding proposal.
   - On testnet (`pnpm dev:testnet`), the DAO steps are signed with MyNearWallet: anyone can create the proposal, and only a council member can approve it. Like `make demo-testnet`, this runs the router with the deployer's keys, so only whoever created the deployment can run it. It changes nothing on-chain at start-up. Without those keys, use `pnpm web:testnet` (read-only).
4. **Live status**: each payout's state, route (e.g. MX-3 → MX-2), the penalty paid to the DAO, the proof reference and tx links. When the batch completes it shows the anchored receipt hash, a receipt download and the `verify-receipt` command.

`/chain/<batch id>` shows any funded batch straight from the contract, with no router, and `/firms` shows each firm's bond, on-time record, penalties and volume. Payout state always comes from the chain, so a reload shows the same state. If the router goes down, a batch page keeps showing the on-chain state it already knows, and says the router is offline.

While the web app runs, logs go to the temp folder `pnpm dev` prints, not to `.data/logs`, because writes inside the repo would make the dev server reload the page.

## Run the tests

```bash
make test              # everything below except the sandbox end-to-end tests
make test-contracts    # cargo: unit + proptest invariants + near-workspaces sandbox scenarios + Sputnik DAO flow
make test-ts           # biome lint, tsc, vitest unit tests
pnpm test:e2e          # TypeScript end-to-end on a local sandbox (local stack + full batch flow)
```

What the tests pin down:

- **Contract invariants** (property tests over random operation sequences):
  - The escrow balance equals open payouts plus bonds.
  - Every payout pays out at most once.
  - Penalties never exceed 2% of a payout or the firm's bond.
  - Penalties go 100% to the funder.
  - No path sends escrowed funds anywhere except the current firm (on a valid proof) or the funder.
- **Sandbox scenarios:**
  - happy path
  - late payout with reroute
  - refund after the deadline
  - closed-account exclusion
  - bond exhaustion
  - paused contract
  - double settlement after a reroute
  - wrong token
  - events with no personal data
  - Sputnik approve, reject, and refund back to the DAO
- **Rejection paths:**
  - wrong oracle signature
  - proof for another payout
  - reused nonce
  - router-only methods
  - config pinned in the funding message, so a config change between vote and execution refunds the batch
- **End to end (TypeScript, sandbox):**
  - exactly one refund (the closed account);
  - an on-time delivery;
  - a reroute away from MX-3 with a penalty, within 10 s of the cut-off;
  - `verify-receipt --chain` OK;
  - the DAO's final balance;
  - no payee name or CLABE in any chain call;
  - after a router restart, the web app's status model equals the contract's views (F13);
  - the firm scoreboard recomputed from the contract's events equals its on-chain counters (F16).
- **Web app (vitest + happy-dom):**
  - status labels and totals;
  - no full CLABE rendered;
  - router offline and contract paused;
  - the validation errors block the batch;
  - only council members can approve;
  - 1Click failures (timeout, HTTP error, bad response, unknown asset) show a message instead of breaking the page.

## Architecture

```
 web app (Next.js): CSV upload, quote, propose & vote, status ── reads contract views via RPC
   │
 CSV ──► router ── builds proposal args ──► council signs add_proposal + act_proposal ──► Sputnik DAO
 (names, CLABEs                                                                              │
  stay local)                                                    ft_transfer_call on approval │
                                                                                              ▼
 router (function-call key) ── assign / reroute / settle / exclude / refund / anchor ──► elivo-escrow
   │  ▲                                                                                 (holds funds:
   │  └── signed proofs / exclusions ── proof oracle (simulated CEP)                    payouts, bonds,
   └── orders ──► payout firms MX-1..MX-3 (simulated) ── deliveries ──► oracle          receipt hashes)
```

- **Only the escrow contract holds funds.** The router can assign, reroute, settle, exclude, refund and anchor receipts; it cannot withdraw.
- **Each batch snapshots the router, the oracle key and the receipt key when it is funded.** The funding message must name the live router and oracle key, so rotating them can't capture a batch that has already been voted.
- **A firm needs owner approval and a bond.** Its open exposure is capped at 20× the bond.
- **Penalty rule:** `min(amount × periods × 1 bp, 2% of amount − penalties so far, bond)`, paid to the DAO.
- **Refunds:** anyone can trigger one after the final deadline, or at once after a signed exclusion. Refunds and settlement still work while the contract is paused.

Repo layout:
- `contracts/`: Rust contracts and their tests, with committed wasm in `contracts/res/`
- `packages/shared/`: CLABE, CSV, money, borsh messages, keys, receipts, chain client, local sandbox stack
- `apps/`: web app, router, oracle and firm simulators
- `scripts/`: demo, deployment and keys
- `docs/superpowers/`: design spec and implementation plans

**Trust model (what this prototype does not solve):**
- The router and the oracle are trusted. Whoever signs delivery proofs releases money.
- In production, a custodian holding a second release key closes that gap.
- The deployer keeps a full-access key to the router account offline; the router service itself only ever uses the function-call key.
- The contract is unaudited.

## Testnet deployment

Demo mode: one penalty period is 10 s.

| Role | Account |
|---|---|
| Escrow | [escrow.pg-1794403941.testnet](https://testnet.nearblocks.io/address/escrow.pg-1794403941.testnet) |
| Mock USDC | [usdc.pg-1794403941.testnet](https://testnet.nearblocks.io/address/usdc.pg-1794403941.testnet) |
| Router (function-call key) | [router.pg-1794403941.testnet](https://testnet.nearblocks.io/address/router.pg-1794403941.testnet) |
| Firms | [mx1](https://testnet.nearblocks.io/address/mx1.pg-1794403941.testnet) · [mx2](https://testnet.nearblocks.io/address/mx2.pg-1794403941.testnet) · [mx3](https://testnet.nearblocks.io/address/mx3.pg-1794403941.testnet) `.pg-1794403941.testnet` |
| DAO (Sputnik v2) | [elivo-1794414333.sputnikv2.testnet](https://testnet.nearblocks.io/address/elivo-1794414333.sputnikv2.testnet) |
| Reference run | Batch 5, receipt anchored in [2qeoXKVn…](https://testnet.nearblocks.io/txns/2qeoXKVnS28WxkdEy5kaAb7CRbk5jRviq2Lq2BavWg3M) |

Batches 0–3 were development runs; their open payouts were refunded to the DAO. Batch 2's anchored hash came from a receipt that changed after signing (a bug since fixed), so it does not verify. Batch 4 is a complete run from before the final review fixes, and batch 5 is the reference.

## Tracks entered and why

- **Real-World Money (primary).** Batch payouts to Mexican bank accounts, with account checks before the run, a delivery deadline, penalties and auditor-ready receipts.
- **Social Money (secondary).** A DAO votes once on a contributor payout batch through an ordinary Sputnik DAO v2 proposal; the guarantee and the receipts attach to that vote.

What is new: intent networks already guarantee crypto delivery. This applies the same bonded, penalised pattern to the fiat last mile.

## Roadmap

- Real payout-firm adapters in place of the simulators, and a bank-side proof source in place of the simulated oracle.
- A custodian-held second release key.
- Sealed commit-reveal quotes; the full set of exclusion reason codes (bank outage, rejection, wrong details).
- Pay-in through 1Click for real (today the app shows a dry quote only).
- More wallets in the web app (MyNearWallet only today).
- An audit before any real funds.

## Disclosures

- Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
- Not a money transmitter and not a live service. No real money, payees, bank details or firm names: all sample data is invented, and the firms are "MX-1", "MX-2" and "MX-3".
- "Guaranteed" and "bonded" here describe testnet mechanics only.
- **TODO (founder): disclosure line about the founder's freelance Aurora role.**

Licensed under [Apache-2.0](LICENSE).
