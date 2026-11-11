#!/usr/bin/env node
// Generates ed25519 keypairs in NEAR format into .data/keys/<name>.json (gitignored).
// Usage: node scripts/gen-keys.mjs oracle receipt mx1 mx2 mx3
// Existing files are kept, so re-running is safe. No dependencies.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "./fetch-sputnik.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "keys");
mkdirSync(dir, { recursive: true });

export function newKeypair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  return {
    public_key: `ed25519:${base58(pub)}`,
    secret_key: `ed25519:${base58(Buffer.concat([seed, pub]))}`,
  };
}

const names = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (names.length === 0) {
  console.error("usage: node scripts/gen-keys.mjs <name>...");
  process.exit(2);
}
for (const name of names) {
  const file = join(dir, `${name}.json`);
  if (existsSync(file)) {
    console.log(`kept   ${file}`);
    continue;
  }
  writeFileSync(file, JSON.stringify(newKeypair(), null, 2) + "\n", { mode: 0o600 });
  console.log(`wrote  ${file}`);
}
