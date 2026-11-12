# Receipts as Accounting Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the `elivo-receipt-1` format (schema and vectors), verify receipts against the chain in the browser at `/verify`, and export verified receipts as CSV.

**Architecture:** A browser-safe verifier in `packages/shared`, using WebCrypto, `canonicalize` and a Buffer-free base58, matches the Node verifier on every vector. A pure CSV builder sits beside it. The web app adds a chain check (`apps/web/lib/verify.ts`) over the existing read-only `/rpc` route, and a `/verify` page.

**Tech Stack:** TypeScript 7, vitest 5 (unit and web projects), Next.js 16, React 19, ajv 8.17.1 (dev only).

**Spec:** `docs/superpowers/specs/2026-11-12-receipts-accounting-design.md`

## Global Constraints

- No contract change, no redeploy; the receipt version stays `elivo-receipt-1`.
- Escrow, network and key come from app config and `get_batch`, never from the file.
- No CSV unless all four checks pass.
- Every new screen and doc carries: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited."
- No payee names, keys or local paths in committed files.
- CSV: RFC 4180, CRLF, formula-prefix guard (`=`, `+`, `-`, `@` get a leading `'`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A receipt edited in a way that keeps it valid JSON but changes a number:** signature fails, no CSV.
2. **A genuine receipt from another escrow or network** (sandbox receipt on the testnet app): it fails the escrow check before any chain read.
3. **A receipt signed with a key that isn't the batch's on-chain `receipt_pk`:** fails, even if the embedded key matches its own signature.
4. **Malformed input** (not JSON, missing `signature`, wrong `version`, a `batch_id` that isn't a number): one clear "malformed" result, no exception.
5. **A genuine, signed but not yet anchored receipt:** the signature passes and "not anchored yet" fails, so no CSV.

---

### Task 1: Browser-safe receipt verification

**Files:**
- Modify: `packages/shared/src/base58.ts` (remove `Buffer`)
- Create: `packages/shared/src/receipt-web.ts`
- Test: `packages/shared/test/receipt-web.test.ts`

**Interfaces:**
- Produces:
  - `verifyReceiptWeb(r: unknown, expectedPk: string): Promise<VerifyResult>` (same `VerifyResult` as `receipt.ts`);
  - `receiptHashB58Web(r: Receipt): Promise<string>`;
  - `totalsProblems(r: Receipt): string[]` (empty means the totals add up).

- [ ] **Step 1:** Write the tests:
  - **Parity:** for a receipt signed in the test with `keyFromSeed(fill 3)`, the web and Node verifiers agree on valid, edited `amount_usdc`, wrong key and missing signature, and both hashes match.
  - `totalsProblems` is `[]` for a receipt from `buildReceiptBody`, and names `paid_to_firms` when that total is edited.
  - The existing base58 tests stay green.
- [ ] **Step 2:** Run `npx vitest run --project unit packages/shared/test/receipt-web.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement with `crypto.subtle` (`Ed25519` verify on `importKey("raw")`, `SHA-256` digest). Recompute totals with the same rules as `apps/router/src/receipt-build.ts`. Rewrite base58's hex conversion without `Buffer`.
- [ ] **Step 4:** Run the unit project. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): browser-safe receipt verifier`.

### Task 2: Published format: JSON Schema and test vectors

**Files:**
- Create:
  - `docs/receipts/elivo-receipt-1.schema.json`
  - `docs/receipts/README.md`
  - `docs/receipts/vectors/*.json`
  - `scripts/gen-receipt-vectors.ts`
- Test: `packages/shared/test/receipt-vectors.test.ts`
- Modify: root `package.json` (devDependency `ajv` 8.17.1, script `gen:vectors`)

**Interfaces:**
- Consumes: Task 1 `verifyReceiptWeb`, `receiptHashB58Web`.
- Produces: `docs/receipts/vectors/manifest.json` as `Array<{ file: string; public_key: string; expect: "ok" | "bad_signature" | "key_mismatch" | "malformed"; receipt_hash: string | null }>`.

- [ ] **Step 1:** Write the tests:
  - every vector file, the reference receipt (Task 5) and a `buildReceiptBody` receipt validate against the schema;
  - for each manifest entry, both verifiers return `expect` and the hash equals `receipt_hash`;
  - running the generator again produces byte-identical files (fixed seed `fill 9`, fixed `generated_at`).
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Write the schema:
  - draft 2020-12, `additionalProperties: false` at every level;
  - u64/u128 values as strings matching `^[0-9]+$`;
  - an enum on `state`;
  - `version` const `elivo-receipt-1`.

  Write the generator: valid, edited amount, wrong key and missing signature.

  Write the README: fields, canonicalisation (RFC 8785), signing, the anchored hash, and how to verify. Include the testnet label.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `docs(receipts): elivo-receipt-1 schema and test vectors`.

### Task 3: CSV export

**Files:**
- Create: `packages/shared/src/receipt-csv.ts`
- Test: `packages/shared/test/receipt-csv.test.ts`

**Interfaces:**
- Consumes: Task 1 `receiptHashB58Web`.
- Produces: `receiptToCsv(r: Receipt, receiptHash: string): string`.

- [ ] **Step 1:** Write the tests:
  - the header equals the spec's column list;
  - for a delivered payout of `1000000000` units at 20 bps: `amount_usdc 1000.000000`, `fee_usdc 2.000000`;
  - a refunded payout has fee `0.000000` and its `reason`;
  - `delivered_at` is ISO UTC (`1794400000000000000` ns → `2026-11-11T…Z`);
  - lines end in CRLF;
  - a field holding `,` or `"` is quoted and doubled;
  - a cell starting with `=` gets a leading `'`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): receipt CSV export`.

### Task 4: Chain check

**Files:**
- Create: `apps/web/lib/verify.ts`
- Test: `apps/web/test/verify.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:

  ```ts
  type Check = { id: "escrow" | "signature" | "anchor" | "totals"; ok: boolean; detail: string };
  verifyAgainstChain(
    input: string,
    app: { escrow: string; network: string },
    view: View,
  ): Promise<{ receipt: Receipt | null; checks: Check[]; ok: boolean; hash: string | null }>;
  ```

- [ ] **Step 1:** Write the tests, covering every Review Focus line:
  - a valid receipt plus an anchored hash gives 4 passes;
  - an edited amount fails `signature`;
  - another escrow fails `escrow` and makes no `view` call;
  - a key that isn't the on-chain `receipt_pk` fails `signature`, with detail naming both keys;
  - not JSON, or a non-numeric `batch_id`, gives one failing check (`detail` "Not an elivo-receipt-1 file") and no `view` call;
  - `receipt_hash` null fails `anchor` with "not anchored yet";
  - an unknown batch fails `anchor` with "No batch N on <escrow>".
- [ ] **Step 2:** Run `npx vitest run --project web apps/web/test/verify.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `view` defaults to `viewCall`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): verify a receipt against the chain`.

### Task 5: `/verify` page

**Files:**
- Create:
  - `apps/web/app/verify/page.tsx`
  - `apps/web/components/VerifyView.tsx`
  - `apps/web/public/receipts/testnet-batch-5.json` (the reference run's receipt)
- Modify:
  - `apps/web/app/layout.tsx` (a "Verify" nav link)
  - `apps/web/components/StatusView.tsx` (receipt card links to `/verify`)
- Test: `apps/web/test/verify-view.test.tsx`

**Interfaces:**
- Consumes: Task 3 `receiptToCsv`, Task 4 `verifyAgainstChain`.

- [ ] **Step 1:** Write the tests:
  - with all checks passing, each check shows a ✓ line and the "Download CSV" button appears;
  - with one check failing, a ✗ line with its detail appears and there is no "Download CSV";
  - the "Use the testnet reference receipt" button appears on testnet only;
  - the testnet label is on the page;
  - the status page's receipt card has the link "Verify in your browser".
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement with the existing primitives (Window `~/verify`, Chip, Ticket, Button). The page holds a file input, a textarea and a Verify button. The CSV downloads through a Blob URL named `elivo-batch-<id>.csv`.
- [ ] **Step 4:** Run the web project plus `pnpm --filter web build`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): /verify page with CSV export`.

### Task 6: Docs

**Files:**
- Modify: `README.md` (web screens list, "What is real" row, link to `docs/receipts/`), `docs/production-readiness.md` (Receipts section and Future list: mark what is now built).

- [ ] **Step 1:** Edit the README and `docs/production-readiness.md`, then run the hygiene grep (no local paths or email) and lint. Expected: clean.
- [ ] **Step 2:** Commit: `docs: receipts format, /verify and CSV`.
