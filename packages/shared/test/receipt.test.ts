import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyFromSeed } from "../src/keys.ts";
import { type ReceiptBody, receiptHashB58, signReceipt, verifyReceipt } from "../src/receipt.ts";

const key = keyFromSeed(new Uint8Array(32).fill(2));
const other = keyFromSeed(new Uint8Array(32).fill(3));

function body(): ReceiptBody {
  return {
    version: "elivo-receipt-1",
    label: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.",
    network: "sandbox",
    escrow: "escrow.test.near",
    batch_id: "0",
    batch_hash: "ab".repeat(32),
    funder: "dao.test.near",
    generated_at: "2026-11-12T10:00:00.000Z",
    payouts: [
      {
        id: 0,
        amount_usdc: "2000000000",
        amount_mxn: "37000.00",
        payee_ref: "cd".repeat(32),
        clabe_last4: "7771",
        state: "Delivered",
        excluded: false,
        reason: null,
        firms_tried: ["mx3.test.near", "mx2.test.near"],
        final_firm: "mx2.test.near",
        quote_bps: 20,
        cutoff_ns: "1",
        final_deadline_ns: "2",
        delivered_at_ns: "1",
        proof_ref: "CEP-SIM-0-0-abcd",
        oracle_sig: "c2ln",
        assigned_at_ns: "1",
        penalties_total: "200000",
        txs: { assign: ["h1"], reroute: ["h2"], settle: ["h3"] },
      },
    ],
    totals: {
      locked: "2005000000",
      paid_to_firms: "2004000000",
      returned_to_funder: "1200000",
      penalties: "200000",
    },
  };
}

describe("verify-receipt --chain", () => {
  it("requires --escrow instead of trusting the escrow named in the file", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "elivo-receipt-"));
    const file = join(dir, "r.json");
    writeFileSync(file, JSON.stringify(signReceipt(body(), key)));
    let out = "";
    let code = 0;
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "packages/shared/src/bin/verify-receipt.ts",
          file,
          "--chain",
          "--rpc",
          "http://127.0.0.1:9",
        ],
        {
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect(code).toBe(1);
    expect(out.trim()).toBe("FAIL: --chain needs --escrow (the file's escrow is not trusted)");
  });
});

describe("receipts", () => {
  it("sign then verify ok", () => {
    expect(verifyReceipt(signReceipt(body(), key), key.publicKeyStr)).toEqual({ ok: true });
  });
  it("edited amount fails", () => {
    const r = signReceipt(body(), key);
    r.payouts[0].amount_usdc = "3000000000";
    expect(verifyReceipt(r, key.publicKeyStr)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("edited signature key fails against the expected key", () => {
    const forged = signReceipt(body(), other);
    expect(verifyReceipt(forged, key.publicKeyStr)).toEqual({ ok: false, reason: "key_mismatch" });
  });
  it("malformed input fails", () => {
    expect(verifyReceipt({} as never, key.publicKeyStr)).toEqual({ ok: false, reason: "malformed" });
  });
  it("key order does not matter", () => {
    const b = body();
    const shuffled = Object.fromEntries(Object.entries(b).reverse()) as unknown as ReceiptBody;
    expect(receiptHashB58(signReceipt(shuffled, key))).toBe(receiptHashB58(signReceipt(b, key)));
  });
  it("cli prints OK and FAIL", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "elivo-receipt-"));
    const file = join(dir, "r.json");
    const cli = ["tsx", "packages/shared/src/bin/verify-receipt.ts", file, "--pubkey", key.publicKeyStr];
    writeFileSync(file, JSON.stringify(signReceipt(body(), key)));
    expect(execFileSync("pnpm", ["exec", ...cli], { encoding: "utf8" }).trim()).toBe("OK");
    const r = signReceipt(body(), key);
    r.totals.penalties = "0";
    writeFileSync(file, JSON.stringify(r));
    let out = "";
    let code = 0;
    try {
      execFileSync("pnpm", ["exec", ...cli], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect(code).toBe(1);
    expect(out.trim()).toBe("FAIL: bad_signature");
  });
});
