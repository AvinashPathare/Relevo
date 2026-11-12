/** Thin NEAR client over near-api-js 7: views, signed calls with explicit gas, block time. */
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas } from "near-api-js";
import type { Network } from "./config.ts";
import type { Ed25519Key } from "./keys.ts";

export class ChainCallError extends Error {
  constructor(
    readonly method: string,
    readonly panic: string,
    message: string,
  ) {
    super(message);
    this.name = "ChainCallError";
  }
}

export interface CallResult {
  txHash: string;
  logs: string[];
  /** JSON-decoded return value of the call, if any. */
  value?: unknown;
}

export interface ChainAccount {
  accountId: string;
  call(
    contractId: string,
    method: string,
    args: object,
    opts: { gasTgas: number; depositYocto?: bigint },
  ): Promise<CallResult>;
}

export interface RecordedCall {
  signer: string;
  contractId: string;
  method: string;
  args: unknown;
  txHash?: string;
  /** Logs of every receipt the call produced (NEP-297 events included). */
  logs?: string[];
}

const PANIC = /(?:Smart contract panicked|Contract panicked): ?(.*?)(?:$|\n|"|\\n)/;

export function panicOf(e: unknown): string | null {
  const m = PANIC.exec(String((e as Error)?.message ?? e));
  return m ? m[1].trim() : null;
}

const TRANSIENT =
  /429|too many requests|rate limit|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|50[234]|timeout/i;

/** Rejects with "timeout: <label>" if `p` doesn't settle within `ms` (RPC requests have no timeout of their own). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label} after ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export class Chain {
  private readonly providers: JsonRpcProvider[];
  private idx = 0;
  readonly calls: RecordedCall[] = [];
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(
    readonly opts: {
      rpcUrl: string;
      network: Network;
      provider?: JsonRpcProvider;
      /** Several providers: on a transient error the client moves to the next one. */
      providers?: JsonRpcProvider[];
      /** Extra RPC URLs to rotate through (testnet public RPCs rate-limit). */
      fallbackRpcUrls?: string[];
      retryDelayMs?: number;
      /** Per-request timeout for views and block queries; signed calls get 6x this. */
      timeoutMs?: number;
    },
  ) {
    this.providers =
      opts.providers ??
      (opts.provider
        ? [opts.provider]
        : [opts.rpcUrl, ...(opts.fallbackRpcUrls ?? [])].map((url) => new JsonRpcProvider({ url })));
    this.retryDelayMs = opts.retryDelayMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** The provider currently in use. */
  get provider(): JsonRpcProvider {
    return this.providers[this.idx];
  }

  /** Runs a read with timeout; on transient errors rotates to the next provider and retries (5 attempts). */
  private async read<T>(label: string, fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await withTimeout(fn(this.provider), this.timeoutMs, label);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (attempt >= 5 || panicOf(e) || !TRANSIENT.test(msg)) throw e;
        this.idx = (this.idx + 1) % this.providers.length;
        await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      }
    }
  }

  /** View call; retries transient RPC errors (rate limits, network), never contract errors. */
  async view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
    return (await this.read(`view ${method}`, (p) =>
      p.callFunction({ contractId, method, args: args as Record<string, unknown> }),
    )) as T;
  }

  account(accountId: string, key: Ed25519Key): Account {
    const kp = KeyPair.fromString(key.secretKeyStr as `ed25519:${string}`);
    return new Account(accountId, this.provider, new KeyPairSigner(kp));
  }

  signer(accountId: string, key: Ed25519Key): ChainAccount {
    return {
      accountId,
      call: async (contractId, method, args, { gasTgas, depositYocto }) => {
        const acct = this.account(accountId, key); // bound to the provider currently in use
        const rec: RecordedCall = { signer: accountId, contractId, method, args };
        this.calls.push(rec);
        try {
          const r = await withTimeout(
            acct.callFunctionRaw({
              contractId,
              methodName: method,
              args: args as Record<string, unknown>,
              gas: teraToGas(gasTgas),
              deposit: depositYocto ?? 0n,
              waitUntil: "EXECUTED_OPTIMISTIC",
            }),
            this.timeoutMs * 6,
            `call ${method}`,
          );
          const txHash = r.transaction?.hash ?? "";
          rec.txHash = txHash;
          const logs = (r.receipts_outcome ?? []).flatMap((o) => o.outcome.logs);
          rec.logs = logs;
          const failure = (r.receipts_outcome ?? []).find(
            (o) => typeof o.outcome.status === "object" && "Failure" in o.outcome.status,
          );
          if (failure) {
            const msg = JSON.stringify(failure.outcome.status);
            throw new ChainCallError(method, panicOf(msg) ?? "failure", msg);
          }
          const sv = (r.status as { SuccessValue?: string } | undefined)?.SuccessValue;
          let value: unknown;
          if (sv) {
            try {
              value = JSON.parse(Buffer.from(sv, "base64").toString("utf8"));
            } catch {
              value = undefined;
            }
          }
          return { txHash, logs, value };
        } catch (e) {
          if (e instanceof ChainCallError) throw e;
          throw new ChainCallError(method, panicOf(e) ?? "error", String((e as Error).message ?? e));
        }
      },
    };
  }

  async blockTimeNs(): Promise<bigint> {
    const b = await this.read("block", (p) => p.viewBlock({ finality: "final" }));
    return BigInt(b.header.timestamp_nanosec);
  }

  explorerTx(hash: string): string | null {
    return this.opts.network === "testnet" ? `https://testnet.nearblocks.io/txns/${hash}` : null;
  }

  explorerAccount(id: string): string | null {
    return this.opts.network === "testnet" ? `https://testnet.nearblocks.io/address/${id}` : null;
  }
}
