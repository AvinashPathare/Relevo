/** Local, off-chain router store (payee names, CLABEs, salts, tx hashes). Not production storage. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PayeeRow } from "@elivo/shared/csv";
import type { Receipt } from "@elivo/shared/receipt";

export interface Draft {
  id: string;
  salt_hex: string;
  rows: PayeeRow[];
  amounts_usdc: string[];
  batch_hash: string;
  created_at: string;
  onchain_batch_id?: string;
  /** payout id → kind (assign/reroute/settle/exclude/refund/anchor) → tx hashes */
  txs: Record<number, Record<string, string[]>>;
  exclusion_reasons: Record<number, string>;
  receipt?: Receipt;
  /** tx hash of anchor_receipt once the receipt hash is on-chain */
  anchor_tx?: string;
}

interface Data {
  drafts: Record<string, Draft>;
}

export class Store {
  private data: Data = { drafts: {} };

  constructor(private readonly file: string | null) {
    if (file) {
      try {
        this.data = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // new store
      }
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  put(d: Draft) {
    this.data.drafts[d.id] = d;
    this.save();
  }
  get(id: string): Draft | undefined {
    return this.data.drafts[id];
  }
  all(): Draft[] {
    return Object.values(this.data.drafts);
  }
  byHash(hash: string): Draft | undefined {
    return this.all().find((d) => d.batch_hash === hash);
  }
  byOnchainId(id: string): Draft | undefined {
    return this.all().find((d) => d.onchain_batch_id === id);
  }
  update(id: string, fn: (d: Draft) => void) {
    const d = this.data.drafts[id];
    if (!d) return;
    fn(d);
    this.save();
  }
  addTx(draftId: string, payoutId: number, kind: string, hash: string) {
    this.update(draftId, (d) => {
      d.txs[payoutId] ??= {};
      d.txs[payoutId][kind] ??= [];
      d.txs[payoutId][kind].push(hash);
    });
  }
}
