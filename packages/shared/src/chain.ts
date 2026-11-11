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
}

const PANIC = /(?:Smart contract panicked|Contract panicked): ?(.*?)(?:$|\n|"|\\n)/;

export function panicOf(e: unknown): string | null {
  const m = PANIC.exec(String((e as Error)?.message ?? e));
  return m ? m[1].trim() : null;
}

export class Chain {
  readonly provider: JsonRpcProvider;
  readonly calls: RecordedCall[] = [];

  constructor(readonly opts: { rpcUrl: string; network: Network }) {
    this.provider = new JsonRpcProvider({ url: opts.rpcUrl });
  }

  async view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
    return (await this.provider.callFunction({
      contractId,
      method,
      args: args as Record<string, unknown>,
    })) as T;
  }

  account(accountId: string, key: Ed25519Key): Account {
    const kp = KeyPair.fromString(key.secretKeyStr as `ed25519:${string}`);
    return new Account(accountId, this.provider, new KeyPairSigner(kp));
  }

  signer(accountId: string, key: Ed25519Key): ChainAccount {
    const acct = this.account(accountId, key);
    return {
      accountId,
      call: async (contractId, method, args, { gasTgas, depositYocto }) => {
        const rec: RecordedCall = { signer: accountId, contractId, method, args };
        this.calls.push(rec);
        try {
          const r = await acct.callFunctionRaw({
            contractId,
            methodName: method,
            args: args as Record<string, unknown>,
            gas: teraToGas(gasTgas),
            deposit: depositYocto ?? 0n,
          });
          const txHash = r.transaction?.hash ?? "";
          rec.txHash = txHash;
          const logs = (r.receipts_outcome ?? []).flatMap((o) => o.outcome.logs);
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
    const b = await this.provider.viewBlock({ finality: "final" });
    return BigInt(b.header.timestamp_nanosec);
  }

  explorerTx(hash: string): string | null {
    return this.opts.network === "testnet" ? `https://testnet.nearblocks.io/txns/${hash}` : null;
  }

  explorerAccount(id: string): string | null {
    return this.opts.network === "testnet" ? `https://testnet.nearblocks.io/address/${id}` : null;
  }
}
