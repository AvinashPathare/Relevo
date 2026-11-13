# From prototype to production

> **Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.**

This page lists what stands between this repo and a service that moves real money. It also covers what can be improved in the current code and where the project could go next. It is honest by design: anything not listed under "What is real today" should be read as not built.

## What is real today

- **Escrow contract** (`contracts/escrow`): funding through a DAO vote, bonded firms, assignment, reroute with penalty, signed exclusions, refunds, a claims ledger and receipt anchoring.
  - Property tests cover its money invariants.
  - It is deployed on NEAR testnet in demo mode, where one penalty period is 10 seconds.
- **Router, oracle and firm simulators** (`apps/`): quotes, assignment, a reroute loop, settlement and signed receipts.
  - The router signs with a function-call key limited to six escrow methods.
- **A real Sputnik DAO v2 vote** funds each batch.
- **Web app** (`apps/web`): upload and validate, quote, propose and vote, live status read from contract views, and a firm scoreboard.
- **Pay-in quote:** a dry mainnet quote from the NEAR Intents 1Click API.
- **Not real:**
  - the payout firms, the proof oracle and the SPEI/CEP references are simulated;
  - USDC is a mock token;
  - the MXN rate is fixed at 18.50.

## What remains for production

Each item names the gap in this repo, then what production needs.

### 1. Smart contract

| Gap today | What production needs |
|---|---|
| Unaudited. | At least one independent audit and a public bug bounty before any real funds. Formal checks of the invariants already property-tested (funds conservation, pay-once, penalty bounds, destinations). |
| The owner is the deployer account, and owner actions take effect at once. | Ownership moves to a multisig or the DAO, with a timelock on `set_router`, `set_oracle_pk`, `set_receipt_pk` and `approve_firm`. Batches already snapshot these keys at funding, so a rotation can't capture funded batches. |
| No upgrade path. | A documented upgrade and migration process (versioned state, migration tests, a staged rollout), or an explicit decision that the contract is immutable. |
| Demo mode (one penalty "hour" is 10 s). | Real-time mode only, with cut-offs and deadlines set by policy and tied to banking hours and SPEI cut-off times. |
| Mock USDC. | Native USDC on NEAR (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`), with storage registration handled for funders and firms. Also tests against the real token's behaviour, such as blocklists and transfer failures, which the claims ledger already anticipates. |
| `list_firms` returns every firm; a batch holds at most 50 payouts. | Paginated views, and limits set from measured gas costs rather than demo values. |
| A penalty is only taken from the bond. | Firm bond top-up and withdrawal policy, minimum bonds per volume tier, and a defined process when a bond is exhausted mid-batch. |

### 2. Trust model

The prototype trusts the router and the oracle: whoever signs delivery proofs releases money. The contract makes this narrow (funds can only go to an approved, bonded firm on a valid proof, or back to the funder), but it is still trust.

Production needs:

- **A second release key** held by an independent custodian or a threshold group, so no single operator can release funds.
- **A real proof source** in place of the simulated oracle. Proofs should be checked against bank-side confirmation of the SPEI transfer (the CEP issued for it), ideally by more than one independent verifier signing (threshold signatures).
- **A dispute window:** a short period after a proof in which the funder or a watcher can challenge it before release. Settlement stays fast in the normal case.
- **Firm keys in hardware:** firms sign quotes and receive payouts with keys in HSMs or MPC wallets.

### 3. Payout rails, compliance and data

- **Licensed payout partners.** The firms must be real, licensed institutions able to send SPEI transfers, onboarded with KYB and legal agreements that match the on-chain bond terms.
- **AML and screening.** KYC/KYB of funders, sanctions screening of payees and funders, transaction monitoring, and Travel Rule handling where it applies. Regulatory reporting in each jurisdiction involved.
- **Personal data.** The router keeps payee names and CLABEs in a local JSON file today.
  - Production needs encrypted storage, access control, audit logs and retention and deletion rules.
  - It also needs compliance with Mexico's data-protection law and the funder's own jurisdiction.
  - On-chain data stays as it is now: only salted hashes and amounts.
- **FX.** The fixed 18.50 rate becomes signed, time-limited MXN quotes from firms (commit-reveal so firms can't copy each other). Rate locks and clear handling when a quote expires between the vote and funding are also needed.
- **Full exclusion reasons.** Only `ACCOUNT_CLOSED` exists today. Bank outage, rejection and wrong details are still to come, each with its own refund and no-penalty rules.

### 4. Off-chain services

| Gap today | What production needs |
|---|---|
| The router is a single process with a JSON file store. | A database with transactions, a durable job queue, and idempotent, exactly-once handling of assign, reroute, settle, exclude, refund and anchor. Several router instances with leader election. |
| It polls contract views and uses optimistic finality. | An indexer for the escrow's NEP-297 events, waiting for final finality before acting, and reconciliation that compares the router's records with the chain on every restart. |
| Public RPC endpoints with fallbacks. | Its own RPC nodes or paid providers with SLAs, plus health checks and failover. |
| Keys are files in `.data/keys`. | Keys in a KMS or HSM, key rotation and key ceremonies, and automatic top-up and alerts for the router's function-call key allowance. |
| The router API has no authentication (localhost only). | Authentication and roles for operators, rate limits, an audit trail, and a public API only behind a gateway. |
| Logs in local files. | Structured logs, metrics and traces; alerts on reroute latency, settlement lag, low bonds and failed transfers in the claims ledger; and runbooks and on-call. |

### 5. Web app

- **Accounts and roles:** operator sign-in, and a separate view for the DAO, firms and auditors.
- **Wallets:** more than MyNearWallet (for example HOT, Ledger and MPC wallets), tested end to end on mainnet.
- **Product polish:** Spanish and English, an accessibility audit, mobile layouts, and clear error states. Several small error states are listed under "Improvements" below.
- **Dev tooling:** `pnpm dev` runs Next's webpack dev server, because Turbopack's dev watcher reloads pages in a loop in this workspace layout. Revisit this when Turbopack supports nested workspace apps better.

### 6. Receipts and audit

Built: the `elivo-receipt-1` format is published as a JSON Schema with test vectors ([`docs/receipts`](receipts/)). The web app's `/verify` page checks a receipt against the chain in the browser, without the repo, and exports it as CSV.

Still needed:
- test vectors checked by verifiers in more than one language;
- receipt key rotation with the key history on-chain (each batch already snapshots `receipt_pk`);
- long-term storage of signed receipts, and a hosted auditor view that doesn't need a local web app.

### 7. Testing and delivery

- **CI must run.** GitHub Actions has not started on the public repo yet: the account is locked for billing.
- **More test types:**
  - fuzzing of the contract's message parsing;
  - load tests at the batch limit;
  - chaos tests (router crash mid-batch, RPC outage, oracle restarts);
  - a multi-day testnet soak.
- **Staged rollout:** mainnet with small caps, monitoring and a pause runbook first, then caps raised as data comes in.

## Improvements to the current code

The final review found these issues; they are now fixed, each covered by a test:

1. **Stale proposals are refused before signing.** Both the demo signer and the wallet signer read the escrow's live config. They refuse a funding proposal whose router or oracle key the escrow would reject, which would otherwise end as "approved, never funded". The demo signer also checks that the deposit equals the DAO's proposal bond.
2. **"Approved: waiting for the escrow" no longer waits silently.** If the escrow has not recorded the batch a while after approval (60 s on sandbox, 3 min on testnet), the page says the escrow may have refused the funding and that the USDC then went back to the DAO.
3. **Unknown ids:**
   - polling stops for a draft the router doesn't know, and for a batch id the escrow doesn't have;
   - an unknown draft no longer offers "Create DAO proposal";
   - `/chain/abc` shows "No batch abc" without querying the chain.
4. **1Click quotes:** one deadline covers the whole request, headers and body, and a timed-out request is cancelled.
5. **Labels:**
   - a late delivery with no penalty says "(no penalty charged)";
   - a payout that no firm took by its cut-off says it will be refunded at the deadline;
   - the firms page reads the exposure multiple from the contract.
6. **Sample buttons:** they report a router error instead of validating the error page as a CSV.
7. **`pnpm dev` clean-up:** a failed start now tears down the local sandbox and the demo signer.
8. **Council list:** only group roles that may approve a function-call proposal count as council.
9. **Refunds recorded once:** the router stores each transaction hash once, so a receipt can't list a refund twice.

Also done:
- the router reuses one near-api-js account per signer, and keeps only the most recent 5,000 calls in its in-memory log;
- the oracle waits up to 120 s for the router on testnet (30 s on sandbox), longer than one signed testnet call can take.

Checked and left as is: event fields like `payout_id` are `u32` in the contract, so JSON numbers are exact in every language. Amounts are already strings.

## Who it is for, and the product ladder

The prototype's funder is a DAO, and that is the only case built and tested. The pattern is wider: anyone who must prove that a payout arrived. The likely first users outside DAOs are:

- **grant and aid programmes**, which report to donors;
- **payroll and contractor platforms**, which handle "I wasn't paid" disputes and audits;
- **payout providers**, which could use a bonded delivery record to win business.

These are assumptions until they are tested in conversations with those buyers.

The product is a ladder. Each level needs less trust than the one before:

1. **Receipt only.** A provider pays as it does today; each batch gets a signed receipt anchored on-chain. Built here: the receipt format, `/verify`, the CSV and the delivery report. Not built: issuing receipts for payouts that didn't go through the escrow.
2. **Receipt with independent proof.** Delivery is checked against the bank's own record (in Mexico, the CEP), not the provider's word. Not built: the oracle is simulated.
3. **Escrow and bonds.** Funds are locked, a late firm is rerouted and its bond pays a penalty. Built here, on testnet, with simulated firms.

Level 1 is the easiest to adopt, so it should be the entry point; level 3 is the upgrade.

## Future of the project

Directions the design already points to, roughly in order:

- **Real pay-in through NEAR Intents.** Turn today's dry 1Click quote into a real deposit, so a DAO can fund a batch from ETH, BTC, SOL or stablecoins on other chains and the USDC lands in the escrow.
- **Sealed-bid quotes and a firm marketplace.** Firms compete on signed, commit-reveal quotes. The on-chain scoreboard (on-time rate, penalties, volume) becomes a reputation that sets bond requirements and routing priority.
- **More payout corridors.** The escrow, bond and penalty pattern doesn't depend on SPEI. Other instant-payment rails could plug in through the same firm and proof interfaces, each with its own proof source.
- **Recurring and streaming payroll.** DAO contributors are often paid monthly, so one vote could approve a schedule rather than a single batch.
- **Funders that are not DAOs.** A company wallet or multisig funds a batch directly, and a provider can issue a receipt for payouts made outside the escrow (level 1 of the ladder).
- **DAO-native operations.** The DAO would own the escrow configuration and firm approvals through proposals, and other DAO frameworks would be supported beyond Sputnik.
- **Receipts as accounting records.** First step built: `/verify` checks a receipt against the chain in the browser and exports it as CSV. Next: exports in the formats accounting systems import directly, and a hosted auditor view.
- **An open delivery-proof standard.** A shared format for "this fiat payment was delivered", so other projects can reuse the same verification, bonding and penalty mechanics for the fiat last mile.

Apart from the first step on receipts noted above, none of this is built yet; it is listed so the direction is clear.
