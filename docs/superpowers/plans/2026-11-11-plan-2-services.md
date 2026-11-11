# Plan 2: Router, Firm Simulators, Oracle, Receipts, `make demo`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`make demo`) runs a full payout batch on a local NEAR sandbox. The batch has a real Sputnik DAO vote, on-time deliveries, a late firm that gets rerouted and pays a penalty, a closed-account exclusion that is refunded, and a signed and anchored receipt that `verify-receipt` accepts. `make demo-testnet` runs the same flow on testnet.

**Architecture:** A pnpm TypeScript workspace.
- `packages/shared` holds the pure, tested building blocks: CLABE, CSV, money, borsh signing, receipts, the chain client, and a local-stack helper that boots a sandbox with everything deployed.
- Three small HTTP services (`apps/oracle`, `apps/firm-sim`, `apps/router`) are Fastify apps built by factories, so tests run them in-process and `main.ts` runs them as processes.
- The router engine is stateless with respect to the chain. Every tick it derives what to do from contract views, and its local store holds only off-chain data: payees, salts and tx hashes.

**Tech stack:** Node 22+, pnpm, TypeScript 7.0.2, tsx 4.23 (no build step), near-api-js 7.5.2, near-sandbox 0.3.5, fastify 5.12, canonicalize 5.1 (RFC 8785), csv-parse 7, vitest 5.1, biome 2.6.

**Spec:** `docs/superpowers/specs/2026-11-11-payout-guard-design.md` (§5 decisions 7–20, §8, §9, §10). **Contract interface:** Plan 1 (merged), in `contracts/escrow/src/{funding,router,payouts,views,events}.rs`.

## Global Constraints

- **Label.** Every README section, CLI banner and HTTP root response that describes the system carries this text: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited."
- **No secrets in the repo.** Keys live in `.data/keys/*.json` (gitignored), or on testnet in `~/.near-credentials/testnet/<account>.json`. `.data/` holds every local store.
- **Number handling.**
  - Amounts are USDC base units (6 decimals) held as `bigint` in TS.
  - u64/u128 travel as decimal strings in JSON.
  - Contract events use JSON numbers for `payout_id`, `quote_bps`, `payout_count` and `reason_code`; strings for everything else.
- **The funding msg pins config.** `fund_batch` msg = `{ kind: "fund_batch", batch_hash: <hex64 lowercase>, router_id, oracle_pk: "ed25519:<b58>", payouts: [{ id, amount, cutoff_in_ns, deadline_in_ns }] }`. `deadline_in_ns` must be ≤ 30 days.
- **Signed messages** are byte-identical to `contracts/escrow/tests/fixtures/signing-vectors.json`: `borsh((domain: string, escrow_id: string, payload))`, with domains `elivo-quote-v1`, `elivo-proof-v1` and `elivo-exclusion-v1`.
- **Gas per call:**
  - `assign` 30 Tgas
  - `reroute` 80
  - `settle` 100
  - `exclude` 30
  - `refund` 80
  - `anchor_receipt` 30
  - DAO `add_proposal` 100
  - DAO `act_proposal` 300
- **The router signs only with the function-call key** `.data/keys/router-fc.json`, which is limited to `assign, reroute, settle, exclude, anchor_receipt, refund`. It never attaches deposits.
- **Oracle nonces** are random 63-bit integers, globally unique across `settle` and `exclude`.
- **Demo timing:**
  - Penalty period 10 s (contract demo mode).
  - Payout `cutoff_in` 40 s, `deadline_in` 300 s.
  - Router grace `DEMO_GRACE_MS = 5000`, poll every 1000 ms on the sandbox and 2000 ms on testnet. Reroute must land within 10 s of the cut-off (F10).
- **Real-time mode:** grace 300 000 ms (F10: within 5 min).
- **FX:** `MXN_PER_USDC = "18.50"` (env-overridable). USDC units = floor(MXN cents × 10⁶ / (rate × 100)).
- **Ports and binding:** router 7400, oracle 7410, MX-1/2/3 on 7421/7422/7423. All bind to 127.0.0.1.
- **Firms:** quotes are MX-1 22 bps, MX-2 20 bps, MX-3 18 bps. Demo bonds are MX-1 1000, MX-2 250 and MX-3 250 USDC (capacity = bond × 20). Modes are MX-1 `ok`, MX-2 `ok`, MX-3 `late`.
- **Sample data (invented, committed):** `samples/payees.csv` (5 valid rows; row 3 is the closed account) and `samples/payees-with-error.csv` (one bad CLABE check digit). The closed-account list is `apps/firm-sim/closed-accounts.json` = `["012180001234567899"]`.
- **Privacy.** Payee names and full CLABEs never appear in any chain call args, event, receipt or log line. Receipts carry `payee_ref = sha256(salt ‖ clabe)` (hex) and `clabe_last4`.

## Review Focus

1. **Router restart mid-batch.** A new engine on the same store and chain picks up where the old one stopped, with no double assigns and no lost reroutes. Pinned in Task 8 (`engine resumes after restart`).
2. **A rerouted firm delivers anyway.** The oracle refuses a firm that is no longer the current one (409) and signs nothing. Pinned in Task 5 (`refuses non-current firm`).
3. **Duplicate proof submission** (firm or network retry). The router settles once; a second submission returns 409 `already_settled` and the engine keeps running. Pinned in Task 8 (`duplicate proof is harmless`).
4. **CSV with BOM, CRLF line endings, quoted names with commas, trailing blank lines.** It parses cleanly. Pinned in Task 1 (`parses BOM CRLF quotes`).
5. **Transient RPC failure during a tick.** The tick logs the failure and the next tick proceeds; the process never crashes. Pinned in Task 8 (`tick survives rpc error`).

---

### Task 1: TS workspace, CLABE, CSV, money

**Files:**
- Create: `package.json` (root, `"private": true`, `"type": "module"`, `packageManager: pnpm@<installed>`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, `module: nodenext`, `target: es2023`, `noEmit`), `biome.json` (formatter 2-space, line width 110, lint recommended)
- Create: `packages/shared/package.json` (name `@elivo/shared`, exports `./src/*.ts`), `packages/shared/src/{clabe,csv,money}.ts`
- Create: `samples/payees.csv`, `samples/payees-with-error.csv`
- Test: `packages/shared/test/{clabe,csv,money}.test.ts`
- Modify: `Makefile` (adds `setup`, `test-ts`; `test` = `test-contracts` + `test-ts`), `.github/workflows/ci.yml` (new `services` job: pnpm install, `pnpm lint`, `pnpm typecheck`, `pnpm test`)

**Interfaces:**
- Root scripts:
  - `setup` = `node scripts/fetch-sputnik.mjs && node scripts/gen-keys.mjs oracle receipt router-fc mx1 mx2 mx3 council`
  - `lint` = `biome check .`
  - `typecheck` = `tsc -p tsconfig.json --noEmit`
  - `test` = `vitest run --project unit`
  - `test:e2e` = `vitest run --project e2e`
- `clabe.ts`:
  - `clabeCheckDigit(first17: string): number`, using weights `3,7,1` repeating; `(10 − Σ(dᵢ·wᵢ mod 10) mod 10) mod 10`
  - `validateClabe(s: string): { ok: true } | { ok: false; reason: "clabe_length" | "clabe_non_digit" | "clabe_check_digit" }`
  - `clabeLast4(s: string): string`
- `csv.ts`:
  - `interface PayeeRow { row: number; name: string; clabe: string; amount_mxn: string }`
  - `interface RowError { row: number; reason: string }`
  - `parsePayeeCsv(text: string): { rows: PayeeRow[]; errors: RowError[] }`
    - Header must be `name,clabe,amount_mxn` (trimmed, case-insensitive), else `{row: 1, reason: "bad_header"}`.
    - Data rows are numbered from 2.
    - More than 50 data rows gives `{row: 0, reason: "too_many_rows"}`.
    - Row reasons: `missing_name`, `missing_clabe`, `missing_amount`, `bad_amount` (must match `^\d+(\.\d{1,2})?$` and be > 0), the CLABE reasons, and `duplicate_clabe`.
- `money.ts`:
  - `DEFAULT_MXN_PER_USDC = "18.50"`, `MAX_FEE_BPS = 25n`
  - `mxnToUsdcUnits(mxn: string, rate: string): bigint`
  - `lockedFor(units: bigint): bigint`
  - `formatUsdc(units: bigint): string` (`"2,000.00"`)
- Sample rows (exact):
  ```
  name,clabe,amount_mxn
  Lucía Fernández,002010077777777771,37000.00
  Mateo Ríos,032180000118359719,37000.00
  Sofía Herrera,012180001234567899,27750.00
  Diego Navarro,072180009876543213,46250.00
  Valentina Cruz,646180005555555554,18500.00
  ```
  The error file is the same, with row 5's CLABE changed to `072180009876543214`.

- [ ] **Step 1: Write the failing tests.**
  - `clabe.test.ts`:
    - check digits: `"00201007777777777" → 1`, `"03218000011835971" → 9`
    - `validateClabe("002010077777777771").ok === true`
    - `"002010077777777772"` → `clabe_check_digit`; `"12345"` → `clabe_length`; `"00201007777777777a"` → `clabe_non_digit`
  - `csv.test.ts`:
    - `samples/payees.csv` → 5 rows, 0 errors
    - the error sample → `[{row: 5, reason: "clabe_check_digit"}]`
    - `parses BOM CRLF quotes`: `"﻿name,clabe,amount_mxn\r\n\"Cruz, Ana\",002010077777777771,10.50\r\n\r\n"` → 1 row, name `Cruz, Ana`
    - 51 rows → `too_many_rows`; duplicate CLABE → `duplicate_clabe`; `-5` and `1.234` → `bad_amount`; bad header → `bad_header`
  - `money.test.ts`:
    - `mxnToUsdcUnits("37000.00","18.50") === 2_000_000_000n`
    - `mxnToUsdcUnits("10.00","18.50") === 540_540n` (rounds down)
    - `lockedFor(1_000_001n) === 1_002_501n`
    - `formatUsdc(2_000_000_000n) === "2,000.00"`
- [ ] **Step 2: Run** `pnpm install && pnpm test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules (use csv-parse/sync with `bom: true`, `relax_column_count: true`, `skip_empty_lines: true`) and the workspace config.
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(shared): TS workspace, CLABE, CSV, money"`

### Task 2: Keys, borsh messages, ed25519

**Files:**
- Create: `packages/shared/src/{base58,keys,messages}.ts`
- Test: `packages/shared/test/messages.test.ts`

**Interfaces:**
- `base58.ts`: `b58encode(bytes: Uint8Array): string`, `b58decode(s: string): Uint8Array`
- `keys.ts`:
  - `interface Ed25519Key { seed: Uint8Array; publicKey: Uint8Array; publicKeyStr: string /* "ed25519:<b58>" */; secretKeyStr: string }`
  - `keyFromSecret(secret: "ed25519:<b58 seed‖pub>"): Ed25519Key`
  - `keyFromSeed(seed: Uint8Array): Ed25519Key`
  - `loadKeyFile(path: string): Ed25519Key` reads gen-keys' `{public_key, secret_key}` or near-cli's `{private_key}`.
  - `sign(key: Ed25519Key, msg: Uint8Array): Uint8Array` (node:crypto, pkcs8 DER prefix + seed)
  - `verify(publicKey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean`
- `messages.ts`:
  - Types:
    ```ts
    interface Quote { batch_id: bigint; payout_id: number; firm_id: string; quote_bps: number }
    interface DeliveryProof { batch_id: bigint; payout_id: number; firm_id: string; delivered_at_ns: bigint; proof_ref: string; nonce: bigint }
    interface Exclusion { batch_id: bigint; payout_id: number; firm_id: string; reason_code: number; observed_at_ns: bigint; nonce: bigint }
    ```
    `REASON_ACCOUNT_CLOSED = 1`
  - `quoteMessage(escrowId, q)`, `proofMessage(escrowId, p)`, `exclusionMessage(escrowId, x)`, each `→ Uint8Array`. Borsh: u32-LE-length strings, LE integers.
  - `proofToJson(p)` and `exclusionToJson(x)` return the contract's JSON shapes (u64 as strings).
  - `randomNonce(): bigint` (63-bit)

- [ ] **Step 1: Write the failing test** `messages.test.ts`. For each entry of `../../contracts/escrow/tests/fixtures/signing-vectors.json`:
  - Building the message from `payload` gives `message_hex`.
  - `sign(keyFromSeed(hex(seed_hex)), msg)` gives `signature_hex`.
  - `keyFromSeed(...).publicKeyStr === "ed25519:" + public_key_b58`.
  - `verify` is true, and false after flipping one byte.
  - A `keys round trip` test: `keyFromSecret(keyFromSeed(s).secretKeyStr)` matches.
- [ ] **Step 2: Run** `pnpm test messages`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test messages`. Expected: PASS (all three vectors byte-identical).
- [ ] **Step 5: Commit.** `git commit -m "feat(shared): borsh messages + ed25519 matching contract vectors"`

### Task 3: Receipts and `verify-receipt`

**Files:**
- Create: `packages/shared/src/receipt.ts`, `packages/shared/src/bin/verify-receipt.ts`
- Test: `packages/shared/test/receipt.test.ts`
- Modify: root `package.json` (script `verify-receipt` = `tsx packages/shared/src/bin/verify-receipt.ts`)

**Interfaces:**
- `ReceiptBody`:
  ```ts
  {
    version: "elivo-receipt-1"; label: string; network: string; escrow: string; batch_id: string; batch_hash: string; funder: string; generated_at: string;
    payouts: Array<{
      id: number; amount_usdc: string; amount_mxn: string; payee_ref: string; clabe_last4: string;
      state: "Delivered" | "Refunded"; excluded: boolean; reason: string | null; firms_tried: string[]; final_firm: string | null;
      quote_bps: number; cutoff_ns: string; final_deadline_ns: string; delivered_at_ns: string | null; proof_ref: string | null;
      penalties_total: string; txs: Record<string, string[]>
    }>;
    totals: { locked: string; paid_to_firms: string; returned_to_funder: string; penalties: string }
  }
  ```
- `Receipt = ReceiptBody & { signature: { alg: "ed25519"; public_key: string; sig: string /* base64 */ } }`
- `signReceipt(body: ReceiptBody, key: Ed25519Key): Receipt` signs `canonicalize(body)`.
- `verifyReceipt(r: Receipt, expectedPublicKey: string): { ok: true } | { ok: false; reason: "key_mismatch" | "bad_signature" | "malformed" }`
- `receiptHashB58(r: Receipt): string` = base58(sha256(canonicalize(r))). This is what gets anchored.
- CLI: `verify-receipt <file> --pubkey <ed25519:…>` or `verify-receipt <file> --chain --rpc <url> --escrow <id>`.
  - Prints `OK` (exit 0) or `FAIL: <reason>` (exit 1).
  - `--chain` takes the key from `get_batch(batch_id).receipt_pk` and also checks `receipt_hash` (`FAIL: not_anchored` / `FAIL: hash_mismatch`).
  - A key embedded in the file is never trusted on its own.

- [ ] **Step 1: Write the failing tests:**
  - `sign then verify ok`
  - `edited amount fails` (change `payouts[0].amount_usdc` → `bad_signature`)
  - `edited signature key fails` (replace `signature.public_key` with another key → `key_mismatch` against the expected key)
  - `key order does not matter` (shuffle body keys → same hash)
  - `cli prints OK and FAIL` (spawn tsx with `--pubkey` on a temp file; edit; expect exit 1 and `FAIL: bad_signature`)
- [ ] **Step 2: Run** `pnpm test receipt`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `--chain` path uses Task 4's `Chain.view`. Add it in Task 4 if Task 4 isn't done, and keep this task's CLI test to `--pubkey`.
- [ ] **Step 4: Run** `pnpm test receipt`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(shared): signed receipts + verify-receipt CLI"`

### Task 4: Chain client, events, local stack

**Files:**
- Create: `packages/shared/src/{chain,events,config}.ts`, `packages/shared/src/testing/localstack.ts`
- Test: `packages/shared/test/localstack.e2e.test.ts`
- Modify: `vitest.config.ts` (projects `unit` = `**/test/**/*.test.ts` excluding `*.e2e.test.ts`; `e2e` = `**/*.e2e.test.ts`, `testTimeout: 300_000`)

**Interfaces:**
- `chain.ts`:
  ```ts
  class Chain {
    constructor(opts: { rpcUrl: string; network: "sandbox" | "testnet" });
    view<T>(contractId: string, method: string, args?: object): Promise<T>;
    signer(accountId: string, key: Ed25519Key): ChainAccount;
    blockTimeNs(): Promise<bigint>;                       // latest final block header timestamp
    explorerTx(hash: string): string | null;              // testnet: https://testnet.nearblocks.io/txns/<hash>; sandbox: null
    explorerAccount(id: string): string | null;
    readonly calls: Array<{ signer: string; contractId: string; method: string; args: unknown; txHash?: string }>; // every call, for the PII scan
  }
  interface ChainAccount {
    accountId: string;
    call(contractId: string, method: string, args: object, opts: { gasTgas: number; depositYocto?: bigint }): Promise<{ txHash: string; logs: string[] }>;
  }
  class ChainCallError extends Error { method: string; panic: string } // panic = contract panic message, e.g. "wrong_firm"
  ```
  Use near-api-js `JsonRpcProvider`, `Account(id, provider, KeyPairSigner)` and `callFunctionRaw`. Read logs from `receipts_outcome[].outcome.logs` and the tx hash from `transaction.hash`. Map `HostGuestPanicError` to `ChainCallError` by extracting the text after `Contract panicked: `.
- `events.ts`: `parseElivoEvents(logs: string[]): Array<{ event: string; data: Record<string, unknown> }>`, which keeps only `EVENT_JSON:` lines with `standard === "elivo"`.
- `config.ts`:
  - `interface Deployment { network: "sandbox" | "testnet"; rpcUrl: string; usdc: string; escrow: string; router: string; firms: { mx1: string; mx2: string; mx3: string }; council: string; dao: string }`
  - `loadDeployment(path)`, `saveDeployment(path, d)`
  - `env()` returns the typed config with the Global Constraints defaults.
- `localstack.ts`: `startLocalStack(opts?: { bondsUsdc?: [bigint, bigint, bigint] }): Promise<LocalStack>`. It:
  1. starts `near-sandbox`;
  2. creates `usdc, escrow, router, mx1, mx2, mx3, council, dao` under the root;
  3. deploys `contracts/res/*.wasm`, with escrow `demo_mode: true` and keys from `.data/keys` (via `gen-keys`, idempotent);
  4. deploys `.cache/sputnikdao2.wasm` to `dao` with `policy: [council]`;
  5. registers everyone on USDC; registers, approves and bonds firms (default `[1000, 250, 250]` USDC);
  6. mints 50,000 USDC to the DAO and gives it 1 NEAR of escrow storage credit;
  7. adds the router function-call key.

  It returns `{ chain, deployment, keys: { oracle, receipt, routerFc, mx1, mx2, mx3, council }, stop(): Promise<void> }`.

- [ ] **Step 1: Write the failing test** `localstack.e2e.test.ts`:
  - `startLocalStack()` boots.
  - `get_config.router_id === deployment.router`.
  - `list_firms` has three approved firms with bonds `1000000000, 250000000, 250000000`.
  - `ft_balance_of(dao) === "50000000000"`.
  - A router function-call key call to `refund` on a missing batch throws `ChainCallError` with `panic === "unknown_batch"`. This proves the function-call key can reach the escrow.
  - A function-call key call to `set_paused` is rejected by the runtime (method not allowed).
  - `stop()` resolves.
- [ ] **Step 2: Run** `node scripts/fetch-sputnik.mjs && pnpm test:e2e localstack`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(shared): chain client, events, local sandbox stack"`

### Task 5: Proof oracle

**Files:**
- Create: `apps/oracle/package.json`, `apps/oracle/src/{oracle,main}.ts`
- Test: `apps/oracle/test/oracle.test.ts`

**Interfaces:**
- `createOracle(deps)` returns a `FastifyInstance`. `deps`:
  ```ts
  {
    escrowId: string; key: Ed25519Key;
    nowNs: () => Promise<bigint>;
    lookupOrder: (batchId: bigint, payoutId: number) => Promise<{ firm_id: string; state: string; excluded: boolean } | null>;
    submitProof: (proofJson: object, sigB64: string) => Promise<void>;
    submitExclusion: (exclusionJson: object, sigB64: string) => Promise<void>;
    nonce?: () => bigint;
  }
  ```
  Routes:
  - `POST /deliveries {batch_id: string, payout_id: number, firm_id: string}` signs a `DeliveryProof` with `delivered_at_ns = await nowNs()` and `proof_ref = "CEP-SIM-<batch>-<payout>-<4 hex>"`, calls `submitProof`, and returns `200 {proof_ref}`. If the order is missing, isn't `Assigned`, is excluded, or `firm_id ≠` the order's firm, it returns `409 {error: "not_current_firm"}` and signs nothing.
  - `POST /exclusions {batch_id, payout_id, firm_id, reason: "ACCOUNT_CLOSED"}` works the same way with `reason_code 1`. Any other reason gives `400 {error: "bad_reason"}`.
  - `GET /` returns `{service: "oracle", label}`.
- `main.ts` reads env and wires `lookupOrder` to `GET {ROUTER_URL}/orders/:batch/:payout`, the submits to `POST {ROUTER_URL}/proofs` and `/exclusions`, and `nowNs` to `Chain.blockTimeNs`. It listens on 127.0.0.1:7410.

- [ ] **Step 1: Write the failing tests** (`app.inject`, fake deps):
  - `signs proof for current firm`: the captured submit's signature verifies against the oracle key via `proofMessage`, and `delivered_at_ns` equals the fake `nowNs`.
  - `refuses non-current firm`: 409, and submit is not called.
  - `refuses excluded or settled order`: 409.
  - `signs exclusion with reason 1`.
  - `rejects other reasons`: 400.
  - `nonces are unique across 1000 calls`.
- [ ] **Step 2: Run** `pnpm test oracle`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test oracle`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(oracle): simulated CEP proof oracle"`

### Task 6: Firm simulators

**Files:**
- Create: `apps/firm-sim/package.json`, `apps/firm-sim/src/{firm,main}.ts`, `apps/firm-sim/closed-accounts.json`
- Test: `apps/firm-sim/test/firm.test.ts`

**Interfaces:**
- `createFirm(deps)` returns a `FastifyInstance`. `deps`:
  ```ts
  {
    firmId: string; escrowId: string; key: Ed25519Key; quoteBps: number;
    mode: "ok" | "late" | "fail"; graceMs: number; closedClabes: Set<string>;
    oracle: { deliver(b: { batch_id: string; payout_id: number; firm_id: string }): Promise<void>;
              exclude(b: { batch_id: string; payout_id: number; firm_id: string; reason: "ACCOUNT_CLOSED" }): Promise<void> };
    schedule?: (ms: number, fn: () => void) => void;  // default setTimeout; tests inject
    random?: () => number;
  }
  ```
  Routes:
  - `POST /quote {batch_id, payout_id, amount}` returns `{firm_id, quote_bps, quote_sig /* base64 */}`, signed over `quoteMessage(escrowId, …)`.
  - `POST /orders {batch_id, payout_id, clabe, amount_mxn, cutoff_ms}` returns `202 {accepted: true}`. It schedules:
    - closed CLABE: `exclude` after 1500 ms, whatever the mode;
    - `ok`: `deliver` after 2000 + random × 2000 ms;
    - `late`: `deliver` after `cutoff_ms + graceMs + 20000` ms;
    - `fail`: nothing.
  - `POST /mode {mode}` returns `200 {mode}`, or `400` if the mode is invalid.
  - `GET /` returns `{service: "firm-sim", firm_id, mode, label}`.

  Delivery errors (for example a 409 after a reroute) are logged, never thrown.
- `main.ts` takes `FIRM=mx1|mx2|mx3` and reads its key, quote, mode, port and account from env/deployment.

- [ ] **Step 1: Write the failing tests:**
  - `quote is signed` (verifies with `quoteMessage`)
  - `ok mode delivers within 4s` (the injected schedule records the ms value: ≥ 2000 and ≤ 4000)
  - `late mode delivers after cutoff plus grace`
  - `fail mode never delivers`
  - `closed account is excluded not delivered` (even in `ok` mode)
  - `mode switch applies to new orders`
  - `oracle 409 is swallowed`
- [ ] **Step 2: Run** `pnpm test firm`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test firm`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(firm-sim): simulated payout firms with ok/late/fail modes"`

### Task 7: Router core (pure parts)

**Files:**
- Create: `apps/router/package.json`, `apps/router/src/{store,validate,proposal,select,receipt-build}.ts`
- Test: `apps/router/test/{validate,proposal,select,receipt-build}.test.ts`

**Interfaces:**
- `store.ts`. `class Store { constructor(file: string) }`, persisted as JSON with atomic write (write tmp, then rename). It holds:
  ```ts
  drafts: Record<string, Draft>
  // Draft: { id: string; salt_hex: string; rows: PayeeRow[]; amounts: bigint[]; batch_hash: string; created_at: string;
  //          onchain_batch_id?: string; txs: Record<number, Record<string, string[]>>; receipt?: Receipt;
  //          exclusion_reasons: Record<number, string> }
  ```
  Methods: `put(d)`, `get(id)`, `byHash(hash)`, `byOnchainId(id)`, `addTx(draftId, payoutId, kind, hash)`.
- `validate.ts`: `validateCsv(text: string, rate: string, newSalt?: () => Uint8Array)` returns `{ ok: boolean; errors: RowError[]; rows: Array<{row, name, clabe_last4, amount_mxn, amount_usdc: string}>; draft?: Draft; total_locked?: string }`.
  - `batch_hash = hex(sha256(canonicalize({ salt: salt_hex, rows: [{ name, clabe, amount_mxn, amount_usdc }] })))`, lowercase.
  - A draft is produced only when there are 0 errors.
- `proposal.ts`: `buildFundingProposal(draft, cfg: { daoId; usdcId; escrowId; routerId; oraclePk; cutoffInNs: bigint; deadlineInNs: bigint; proposalBondYocto: string })` returns `{ contractId: daoId, method: "add_proposal", args: { proposal: { description, kind } }, depositYocto, gasTgas: 100, kind }`.
  - The kind is `FunctionCall` on `usdcId`: `ft_transfer_call(receiver_id: escrowId, amount: Σlocked, msg: <pinned fund msg>)`, deposit `"1"`, gas `"150000000000000"`.
  - The description is `Elivo payout batch <id>: <n> payouts, <total> USDC (testnet prototype)`.
- `select.ts`:
  - `pickFirm(quotes: Array<{firm_id; quote_bps; quote_sig}>, firms: Record<string, {bond: bigint; open_exposure: bigint; approved: boolean}>, tried: string[], amount: bigint, multiple = 20n)` returns the lowest-bps eligible quote (tie broken by `firm_id`) or `null`. Eligible means approved, not tried, and `open_exposure + amount ≤ bond × multiple`.
  - `decide(p: PayoutView, nowNs: bigint, graceNs: bigint): "assign" | "reroute" | "refund" | "wait" | "done"`:
    - `Funded` and `now < cutoff` → `assign`
    - `Assigned` and not excluded and `cutoff + grace < now < deadline` → `reroute`
    - (`excluded` or `now > deadline`) and not terminal → `refund`
    - terminal → `done`
    - otherwise → `wait`
- `receipt-build.ts`: `buildReceiptBody(draft, batch: BatchView, payouts: PayoutView[], network, escrowId, rate)` returns a `ReceiptBody`. Totals come from views: `paid_to_firms = Σ(amount + amount·quote_bps/10000)` over Delivered payouts; `returned_to_funder = locked − paid_to_firms + penalties`.

- [ ] **Step 1: Write the failing tests:**
  - `validate.test.ts`:
    - `samples/payees.csv` → `ok`, 5 rows, `total_locked "9022500000"`, a 64-hex lowercase hash
    - the hash changes with the salt
    - the error sample → not ok, no draft
    - the result JSON contains no full CLABE
  - `proposal.test.ts`:
    - decoding `kind.FunctionCall.actions[0].args` (base64 JSON) gives `receiver_id = escrow`, `amount = "9022500000"`
    - its msg parses with `router_id`, `oracle_pk`, 5 payouts, `cutoff_in_ns "40000000000"`
    - no payee name or CLABE appears anywhere in the JSON
  - `select.test.ts`:
    - cheapest wins
    - over-capacity is skipped
    - tried is skipped
    - all ineligible → `null`
    - every `decide` boundary: `now == cutoff + grace` → `wait`, `+1` → `reroute`; `now == deadline` → `wait`, `+1` → `refund`; excluded → `refund`
  - `receipt-build.test.ts`: built from fixture views (1 delivered on time, 1 rerouted with a 2000-unit penalty, 1 excluded refund), the totals and the per-payout fields match, and `payee_ref` = sha256(salt‖clabe).
- [ ] **Step 2: Run** `pnpm test router`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test router`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(router): validation, proposal builder, selection, receipt builder"`

### Task 8: Router engine, HTTP API, end-to-end on the sandbox

**Files:**
- Create: `apps/router/src/{engine,server,main}.ts`
- Test: `apps/router/test/engine.test.ts` (unit, fake chain), `apps/router/test/flow.e2e.test.ts`

**Interfaces:**
- `class Engine`, `constructor(deps)`:
  ```ts
  {
    chain: Chain; router: ChainAccount /* router-fc key */; escrowId: string; store: Store;
    firms: Array<{ id: string; url: string }>; graceNs: bigint; receiptKey: Ed25519Key;
    network: string; rate: string; log?: (msg: string, data?: object) => void;
  }
  ```
  Methods:
  - `tick(): Promise<void>`:
    - Links new on-chain batches (`get_batch_count`, `get_batch`) to drafts by `batch_hash`.
    - For every linked open batch, reads `get_batch_payouts` once and acts on `decide()`:
      - **assign:** collect quotes (`POST /quote`), read firms (`list_firms`), `pickFirm`, `assign`, then `POST /orders` with `cutoff_ms` derived from the view.
      - **reroute:** quotes from untried firms, then `reroute`, then a new order.
      - **refund:** `refund`.
    - When all payouts are terminal and none is anchored: build, sign and store the receipt, then `anchor_receipt`.
    - Every call's tx hash goes to `store.addTx`.
    - Errors are caught per payout and logged; a tick never throws.
  - `submitProof(json, sigB64): Promise<{ ok: true } | { ok: false; status: 409 | 400; error: string }>` calls `settle`. Panics `wrong_state` / `wrong_firm` / `nonce_used` → `409 already_settled` / `not_current_firm` / `nonce_used`.
  - `submitExclusion(json, sigB64)` calls `exclude`, then `refund` straight away.
  - `order(batchId, payoutId)` returns the view slice the oracle needs.
- `createRouterServer(engine, deps)` returns a `FastifyInstance` with these routes (spec §8 plus internal ones):
  - `POST /batches/validate` (body `text/csv` or `{csv}`) → `validateCsv` result, storing the draft
  - `POST /batches/:id/proposal` → `buildFundingProposal` (reads `get_policy.proposal_bond`)
  - `GET /batches/:id` → `{ draft summary (masked), onchain: batch, payouts: PayoutView[] with explorer links, receipt_ready }`
  - `GET /batches/:id/receipt` → `404` until ready
  - `GET /orders/:batch/:payout`
  - `POST /proofs` and `POST /exclusions`
  - `POST /sim/firms/:id/mode` → proxied to the firm
  - `GET /firms` → `list_firms`
  - `GET /` → label
- `main.ts`: loads the deployment and keys, then `setInterval(tick, POLL_MS)` with a single-flight guard.

- [ ] **Step 1: Write the failing unit tests** (`engine.test.ts`, fake chain + fake firms):
  - `tick survives rpc error` (the first `view` rejects; the next tick assigns)
  - `duplicate proof is harmless` (second `submitProof` → `409 already_settled`; one `settle` call recorded)
  - `engine resumes after restart` (a new Engine on the same store, with a chain fake whose payouts are already Assigned past grace → exactly one `reroute`, no `assign`)
- [ ] **Step 2: Write the failing e2e test** `flow.e2e.test.ts`:
  - `startLocalStack()`; start the oracle, three firms (MX-3 `late`) and the router in-process on ports 0.
  - Validate `samples/payees.csv`, get the proposal, then the council calls `add_proposal` and `act_proposal(VoteApprove, proposal: kind)`.
  - Wait until all 5 payouts are terminal and the receipt is anchored (timeout 240 s).
  - Assert:
    - (a) exactly one `Refunded` payout, id 2, `excluded: true`, `penalties_total "0"`
    - (b) at least one `Delivered` payout with `firms_tried.length === 1` and `final_firm ≠ mx3`
    - (c) at least one payout with `firms_tried[0] === mx3`, `firms_tried.length ≥ 2` and `penalties_total > 0`
    - (d) every reroute tx happened ≤ 10 s after its payout's cut-off (block time of the `payout_rerouted` tx vs `cutoff_ns` before the reroute, both from logged events)
    - (e) `verify-receipt --chain` prints `OK`
    - (f) the DAO's USDC balance equals `50000000000 − Σpaid_to_firms`
    - (g) no element of `chain.calls[*].args` (JSON-stringified) contains any payee name or full CLABE from the CSV (F3)
- [ ] **Step 3: Run** `pnpm test engine && pnpm test:e2e flow`. Expected: FAIL.
- [ ] **Step 4: Implement** engine, server and main.
- [ ] **Step 5: Run** the same commands. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(router): engine, HTTP API, full flow on sandbox"`

### Task 9: `make demo` and `make demo-testnet`

**Files:**
- Create: `scripts/demo.ts`, `scripts/lib/procs.ts` (spawn/kill child processes, wait for `GET /`), `scripts/testnet-dao.sh`
- Modify: `Makefile` (`demo`, `demo-testnet`), `scripts/deploy-testnet.sh` (writes `dao` after `testnet-dao.sh`), `deployments/testnet.json`

**Interfaces:**
- `scripts/demo.ts [--network sandbox|testnet] [--keep]`:
  - **sandbox:** `startLocalStack`.
  - **testnet:** loads `deployments/testnet.json` and keys from `~/.near-credentials/testnet` (council) and `.data/keys`. It sets the bonds to MX-1 1000 / MX-2 250 / MX-3 250 USDC with `withdraw_bond` / `post_bond`, as each firm.
  - Spawns the oracle, three firm-sims and the router as child processes, with env pointing at the deployment.
  - Prints a narrated story, each step one line with explorer links on testnet:
    1. CSV validated (and the error sample shows its row error)
    2. proposal created
    3. vote approved → batch funded
    4. assignments (firm + bps)
    5. MX-3 late → rerouted, penalty X USDC to the DAO
    6. closed account excluded → refunded in full
    7. on-time deliveries
    8. receipt anchored
    9. `verify-receipt` OK
  - Writes the receipt to `.data/receipts/batch-<id>.json`.
  - Exits 0 only if the same outcome checks as Task 8 (a)–(e) pass; otherwise it prints which check failed and exits 1.
  - Kills child processes on exit or SIGINT.
- `scripts/testnet-dao.sh`:
  - Resumable steps, same `step`/`retry` helpers as `deploy-testnet.sh` (factor them into `scripts/lib/near-steps.sh`).
  - Creates two faucet accounts, pools them into `council`, and calls `sputnikv2.testnet create` with `{ name: "elivo-<ts>", args: base64({ config: { name, purpose: "Elivo Payout Guard demo (testnet)", metadata: "" }, policy: [council] }) }`. Deposit: the amount the factory requires (start at 6 NEAR; raise if it rejects).
  - Mints 50,000 mUSDC to the DAO, storage-registers it on USDC, and gives it 1 NEAR of escrow storage credit.
  - Writes `"dao"` into `deployments/testnet.json`.

- [ ] **Step 1: Run** `make demo`. Expected: exits 0 within ~2 minutes and prints the story ending in `verify-receipt: OK`.
- [ ] **Step 2: Run** `./scripts/testnet-dao.sh`, then `make demo-testnet`. Expected: exits 0, and explorer links open the real txs. Record the batch id and receipt path.
- [ ] **Step 3: Commit.** `git commit -m "feat: make demo (sandbox) and make demo-testnet"`. `deployments/testnet.json` is updated; no keys are committed.

### Task 10: README, env example, CI demo, fresh-clone check

**Files:**
- Create: `.env.example` (every variable from `config.ts` `env()` with its default and a one-line comment), `Dockerfile.freshclone` (FROM `node:22-bookworm`, installs rustup 1.95.0 + wasm target, cargo-near 0.23.0, pnpm; `COPY . .`; runs `pnpm install && pnpm setup && make demo && make test`)
- Modify:
  - `README.md` (full rewrite, in the PRD's section order: what it is in two sentences; real vs simulated; quick start in 3 commands; run the demo; run the tests; architecture; testnet addresses with explorer links; tracks entered and why; roadmap; disclosures, with the label)
  - `.github/workflows/ci.yml` (the `services` job adds `make sputnik`, `pnpm test:e2e` and `make demo`)

**Interfaces:**
- README claims must each map to a test or a command in this repo. Write the "what is simulated" list from the code: the firm sims, the oracle and CEP refs, FX, mock USDC, demo-mode periods.
- The README states the trust model plainly:
  - The router and oracle are trusted.
  - The router signs only with a function-call key limited to six methods.
  - The deployer keeps a full-access key to the router account offline.
  - Production adds a custodian-held second release key.
  - The contract is unaudited.
- The disclosures section in the README has a placeholder line for the founder's freelance Aurora disclosure. The founder writes the wording; flag it in the hand-off.

- [ ] **Step 1: Run** `docker build -f Dockerfile.freshclone -t elivo-freshclone . && docker run --rm elivo-freshclone`. Expected: the demo prints `verify-receipt: OK` and all tests pass. Fix anything that needs a step not in the README.
- [ ] **Step 2: Check claims.** For each README claim, grep for its test or command and list the pairs in the commit message body.
- [ ] **Step 3: Commit.** `git commit -m "docs: README matching the code; CI runs the demo; fresh-clone Dockerfile"`
