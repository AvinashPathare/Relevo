/** ed25519 keys in NEAR's string format, signing with node:crypto (no extra dependencies). */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { b58decode, b58encode } from "./base58.ts";

export interface Ed25519Key {
  seed: Uint8Array;
  publicKey: Uint8Array;
  /** "ed25519:<base58 public key>" */
  publicKeyStr: string;
  /** "ed25519:<base58 seed ‖ public key>" (NEAR secret key format) */
  secretKeyStr: string;
}

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const privateKeyObject = (seed: Uint8Array) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });

export function keyFromSeed(seed: Uint8Array): Ed25519Key {
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const spki = createPublicKey(privateKeyObject(seed)).export({ format: "der", type: "spki" });
  const publicKey = new Uint8Array(spki.subarray(SPKI_PREFIX.length));
  return {
    seed: Uint8Array.from(seed),
    publicKey,
    publicKeyStr: `ed25519:${b58encode(publicKey)}`,
    secretKeyStr: `ed25519:${b58encode(Uint8Array.from([...seed, ...publicKey]))}`,
  };
}

export function keyFromSecret(secret: string): Ed25519Key {
  const [curve, body] = secret.split(":");
  if (curve !== "ed25519" || !body) throw new Error("ed25519 secret key required");
  const bytes = b58decode(body);
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error("bad ed25519 secret key length");
  return keyFromSeed(bytes.subarray(0, 32));
}

/** Reads gen-keys output (`secret_key`) or a near-cli credentials file (`private_key`). */
export function loadKeyFile(path: string): Ed25519Key {
  const j = JSON.parse(readFileSync(path, "utf8")) as { secret_key?: string; private_key?: string };
  const secret = j.secret_key ?? j.private_key;
  if (!secret) throw new Error(`no secret key in ${path}`);
  return keyFromSecret(secret);
}

export function publicKeyFromString(s: string): Uint8Array {
  const [curve, body] = s.split(":");
  if (curve !== "ed25519" || !body) throw new Error("ed25519 public key required");
  return b58decode(body);
}

export function sign(key: Ed25519Key, msg: Uint8Array): Uint8Array {
  return new Uint8Array(cryptoSign(null, msg, privateKeyObject(key.seed)));
}

export function verify(publicKey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (sig.length !== 64 || publicKey.length !== 32) return false;
  const pub = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
  return cryptoVerify(null, msg, pub, sig);
}
