/**
 * verify-receipt <file> --pubkey <ed25519:...>
 * verify-receipt <file> --chain --rpc <url> --escrow <account>
 * Prints OK (exit 0) or FAIL: <reason> (exit 1). A key embedded in the file is never trusted alone.
 */
import { readFileSync } from "node:fs";
import { type Receipt, receiptHashB58, verifyReceipt } from "../receipt.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(reason: string): never {
  console.log(`FAIL: ${reason}`);
  process.exit(1);
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error(
      "usage: verify-receipt <file> (--pubkey <ed25519:...> | --chain --rpc <url> --escrow <id>)",
    );
    process.exit(2);
  }
  let receipt: Receipt;
  try {
    receipt = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail("unreadable");
  }
  let expected = arg("--pubkey");
  const anchored: string | null | undefined = undefined;
  if (process.argv.includes("--chain")) fail("--chain arrives with the chain client (plan 2 task 4)");
  if (!expected) fail("no expected public key (use --pubkey or --chain)");
  const v = verifyReceipt(receipt, expected);
  if (!v.ok) fail(v.reason);
  if (anchored !== undefined) {
    if (!anchored) fail("not_anchored");
    if (anchored !== receiptHashB58(receipt)) fail("hash_mismatch");
  }
  console.log("OK");
}

main().catch((e) => fail(`error: ${(e as Error).message}`));
