#!/usr/bin/env node
// Fetches the Sputnik DAO v2 contract wasm that the testnet factory deploys by default, verifies
// its code hash, and caches it at .cache/sputnikdao2.wasm. No dependencies (Node 20+).
//
// Source: factory `sputnikv2.testnet`, method get_code(code_hash).
// Upstream: https://github.com/near-daos/sputnik-dao-contract (third-party; not part of this repo).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CODE_HASH = "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH";
const FACTORY = "sputnikv2.testnet";
const RPC = process.env.NEAR_TESTNET_RPC ?? "https://rpc.testnet.near.org";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".cache", "sputnikdao2.wasm");

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

const hashOf = (buf) => base58(createHash("sha256").update(buf).digest());

if (process.argv.includes("--print-source")) {
  console.log(`factory: ${FACTORY}\ncode_hash: ${CODE_HASH}\nupstream: https://github.com/near-daos/sputnik-dao-contract`);
  process.exit(0);
}

if (existsSync(out) && hashOf(readFileSync(out)) === CODE_HASH) {
  console.log(`sputnik wasm cached and verified: ${out}`);
  process.exit(0);
}

const args = Buffer.from(JSON.stringify({ code_hash: CODE_HASH })).toString("base64");
const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "elivo",
    method: "query",
    params: { request_type: "call_function", finality: "final", account_id: FACTORY, method_name: "get_code", args_base64: args },
  }),
});
const body = await res.json();
if (!body.result?.result) {
  console.error("RPC error fetching sputnik wasm:", JSON.stringify(body).slice(0, 400));
  process.exit(1);
}
const wasm = Buffer.from(body.result.result);
const got = hashOf(wasm);
if (got !== CODE_HASH) {
  console.error(`hash mismatch: expected ${CODE_HASH}, got ${got}`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, wasm);
console.log(`sputnik wasm fetched and verified (${wasm.length} bytes): ${out}`);
