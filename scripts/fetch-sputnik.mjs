#!/usr/bin/env node
// Fetches the Sputnik DAO v2 contract wasm that the testnet factory deploys by default, verifies
// its code hash, and caches it at .cache/sputnikdao2.wasm. No dependencies (Node 20+).
//
// Source: factory `sputnikv2.testnet`, method get_code(code_hash).
// Upstream: https://github.com/near-daos/sputnik-dao-contract (third-party; not part of this repo).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CODE_HASH = "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH";
const FACTORY = "sputnikv2.testnet";
// rpc.testnet.near.org is deprecated and rate-limited; try FastNEAR first, then fall back.
const RPCS = [
  process.env.NEAR_TESTNET_RPC,
  "https://test.rpc.fastnear.com",
  "https://rpc.testnet.fastnear.com",
  "https://rpc.testnet.near.org",
].filter(Boolean);
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
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await main();

async function main() {
  if (process.argv.includes("--print-source")) {
    console.log(
      `factory: ${FACTORY}\ncode_hash: ${CODE_HASH}\nupstream: https://github.com/near-daos/sputnik-dao-contract`,
    );
    process.exit(0);
  }

  if (existsSync(out) && hashOf(readFileSync(out)) === CODE_HASH) {
    console.log(`sputnik wasm cached and verified: ${out}`);
    process.exit(0);
  }

  const args = Buffer.from(JSON.stringify({ code_hash: CODE_HASH })).toString("base64");
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: "elivo",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: FACTORY,
      method_name: "get_code",
      args_base64: args,
    },
  });
  let body;
  const errors = [];
  for (let attempt = 0; attempt < RPCS.length * 2 && !body; attempt++) {
    const rpc = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: request,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      const json = JSON.parse(text);
      if (json.result?.result) body = json;
      else errors.push(`${rpc}: ${text.slice(0, 120)}`);
    } catch (e) {
      errors.push(`${rpc}: ${e.message}`);
    }
    if (!body) await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
  }
  if (!body) {
    console.error(`could not fetch the Sputnik wasm from any RPC:\n  ${errors.join("\n  ")}`);
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
}
