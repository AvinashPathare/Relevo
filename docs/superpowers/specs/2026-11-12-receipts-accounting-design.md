# Receipts as accounting records — design

Date: 2026-11-12 · Status: founder chose this item from the "Future of the project" list ("Receipts for accounting"); the founder skipped questions, so the details below are the designer's calls · Applies to `packages/shared`, `apps/web`, `docs/receipts`

> Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.

## Intent

Every batch already ends with a signed receipt whose hash is anchored in the escrow. Today only a developer can check one: they need the repo and `pnpm verify-receipt`. This work makes a receipt something an accountant or auditor can use:

- check it in a browser, against the chain, without the repo or trusting the operator;
- export it as a CSV their tools import;
- implement a verifier in another language from a published format and test vectors.

It is the first concrete step towards the "open delivery-proof standard" direction in `docs/production-readiness.md`.

## Goals

1. **Published format.** A JSON Schema for `elivo-receipt-1`, plus test vectors (valid, edited, wrong key) whose expected verdicts and hashes are pinned by tests. They live in `docs/receipts/`.
2. **Browser verifier.** A `/verify` page: upload, paste, or (on testnet) load the reference receipt for batch 5. It runs four checks and shows each one passing or failing:
   - **Escrow:** the receipt's escrow and network are this app's (escrow from the app's config, never from the file).
   - **Signature:** an ed25519 signature by the batch's on-chain `receipt_pk` (key read from `get_batch`, never from the file alone).
   - **Anchor:** the receipt's hash equals the hash anchored on-chain.
   - **Totals:** the totals add up from the payout rows, by the same rules the router used.
3. **CSV export.** One row per payout, with plain decimals, ISO 8601 UTC times, and the batch id and receipt hash on every row. It is offered only once all four checks pass.
4. **Link from the status page.** The receipt card links to `/verify`.

## Non-goals

- No contract change, no redeploy, no new receipt version. The existing `elivo-receipt-1` is documented as it is.
- No accounting-system integrations (Xero, QuickBooks). CSV only.
- No server-side verification. The point is that the browser checks the chain itself, through the existing read-only `/rpc` route.

## Anti-goals

- Unverified data must never look verified. If any check fails, the page shows which one and offers no CSV.
- No trust in anything the file says about where to check it. Escrow, RPC and key come from the app's config and the chain.
- No payee names in any published file. Receipts carry only salted payee refs, the last 4 CLABE digits and amounts. The reference receipt uses the fictitious sample payees.

## Constraints

- Browser-safe: WebCrypto (`crypto.subtle`, Ed25519 and SHA-256), `canonicalize` (already a dependency), and a Buffer-free base58. It must give the same verdicts and hashes as the Node verifier on every vector.
- Schema validation in tests uses `ajv` 8.17.1 (dev dependency only, JSON Schema 2020-12).
- Every screen and the new docs carry the testnet label line.
- The CSV is safe to open in spreadsheets: a cell that starts with `=`, `+`, `-` or `@` gets a leading `'`. Quoting follows RFC 4180 with CRLF line endings.

## Designer's calls

- **CSV columns:** `batch_id, network, escrow, receipt_hash, payout_id, state, amount_usdc, fee_usdc, penalty_usdc, amount_mxn, payee_ref, clabe_last4, final_firm, firms_tried, delivered_at, reason, proof_ref, tx_hashes`.
  - USDC values use 6 decimal places with no thousands separator.
  - `fee_usdc` is amount × quote_bps / 10,000 for delivered payouts, else 0.
  - `firms_tried` and `tx_hashes` are joined with ` > ` and ` ` (as `kind:hash`).
- **Where the reference receipt lives:** `apps/web/public/receipts/testnet-batch-5.json` (served statically). The "Use the testnet reference receipt" button shows only on testnet.
- **Nav:** a "Verify" link next to Firms.
