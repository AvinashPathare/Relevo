import { describe, expect, it } from "vitest";
import { SIGNING_KEY, vectorBody } from "../../../scripts/lib/receipt-vectors.ts";
import { signReceipt } from "../src/receipt.ts";
import { CSV_COLUMNS, receiptToCsv } from "../src/receipt-csv.ts";

const receipt = () => signReceipt(vectorBody(), SIGNING_KEY);
const lines = (csv: string) => csv.split("\r\n");
const cells = (csv: string, row: number) => {
  const header = lines(csv)[0].split(",");
  const values = lines(csv)[row + 1].split(",");
  return Object.fromEntries(header.map((h, i) => [h, values[i]]));
};

describe("receiptToCsv", () => {
  it("has the published header, one row per payout, CRLF line endings", () => {
    const csv = receiptToCsv(receipt(), "HASH");
    expect(lines(csv)[0]).toBe(
      "batch_id,network,escrow,receipt_hash,payout_id,state,amount_usdc,fee_usdc,penalty_usdc,amount_mxn,payee_ref,clabe_last4,final_firm,firms_tried,delivered_at,reason,proof_ref,tx_hashes",
    );
    expect(CSV_COLUMNS).toHaveLength(18);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)).toHaveLength(1 + 3 + 1); // header, 3 payouts, trailing empty string
    expect(csv.includes("\n") && !/[^\r]\n/.test(csv)).toBe(true);
  });

  it("writes a delivered payout as plain decimals with its fee", () => {
    expect(cells(receiptToCsv(receipt(), "HASH"), 0)).toMatchObject({
      batch_id: "7",
      network: "testnet",
      escrow: "escrow.example.testnet",
      receipt_hash: "HASH",
      payout_id: "0",
      state: "Delivered",
      amount_usdc: "1000.000000",
      fee_usdc: "2.000000",
      penalty_usdc: "0.000000",
      amount_mxn: "18500.00",
      clabe_last4: "7771",
      final_firm: "mx1.example.testnet",
      delivered_at: "2026-11-11T17:59:50.000Z",
      reason: "",
      proof_ref: "CEP-SIM-7-0-0001",
      tx_hashes: `assign:${"A".repeat(44)} settle:${"B".repeat(44)}`,
    });
  });

  it("writes the reroute route and the late firm's penalty", () => {
    expect(cells(receiptToCsv(receipt(), "HASH"), 1)).toMatchObject({
      firms_tried: "mx3.example.testnet > mx2.example.testnet",
      fee_usdc: "4.000000",
      penalty_usdc: "0.400000",
    });
  });

  it("gives a refund no fee, no delivery time, and its reason", () => {
    expect(cells(receiptToCsv(receipt(), "HASH"), 2)).toMatchObject({
      state: "Refunded",
      fee_usdc: "0.000000",
      final_firm: "",
      delivered_at: "",
      reason: "ACCOUNT_CLOSED",
    });
  });

  it("quotes commas and quotes, and defuses cells a spreadsheet would run as formulas", () => {
    const r = receipt();
    r.payouts[0].proof_ref = 'CEP, "x"';
    r.payouts[1].proof_ref = "=HYPERLINK(1)";
    r.payouts[2].amount_mxn = "-1.00";
    const csv = receiptToCsv(r, "HASH");
    expect(csv).toContain(',"CEP, ""x""",');
    expect(csv).toContain(",'=HYPERLINK(1),");
    expect(csv).toContain(",'-1.00,");
  });
});
