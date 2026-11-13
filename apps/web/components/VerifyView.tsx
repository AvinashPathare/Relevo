"use client";
import { LABEL } from "@elivo/shared/label";
import { formatUsdc } from "@elivo/shared/money";
import { receiptToCsv } from "@elivo/shared/receipt-csv";
import { useState } from "react";
import { type CheckId, type VerifyOutcome, verifyAgainstChain } from "../lib/verify.ts";
import { Button, Chip, Eyebrow, Sticker, Ticket, Window } from "./ui.tsx";

const CHECK_NAME: Record<CheckId, string> = {
  format: "File",
  escrow: "Escrow",
  signature: "Signature",
  anchor: "Anchored on-chain",
  totals: "Totals",
};

/** Hands the browser a file to save (a Blob link, clicked once). */
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export interface VerifyViewProps {
  /** Escrow and network from this app's config: what a receipt must belong to. */
  app: { escrow: string; network: "sandbox" | "testnet" };
  /** Injectable for tests. */
  verify?: (input: string) => Promise<VerifyOutcome>;
  save?: (name: string, text: string) => void;
}

export function VerifyView({ app, verify, save = saveFile }: VerifyViewProps) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = verify ?? ((input: string) => verifyAgainstChain(input, app));

  const run = async (input: string) => {
    setText(input);
    setOutcome(null);
    setError(null);
    setBusy(true);
    try {
      setOutcome(await check(input));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reference = async () => {
    try {
      const r = await fetch("/receipts/testnet-batch-5.json");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await run(await r.text());
    } catch (e) {
      setError(`Could not load the reference receipt: ${(e as Error).message}`);
    }
  };

  const r = outcome?.receipt;
  const status = !outcome ? "idle" : outcome.ok ? "done" : "offline";
  return (
    <div className="stack">
      <Window title="~/verify" status={status}>
        <div className="row" style={{ marginBottom: 14 }}>
          {app.network === "testnet" && (
            <Button onClick={reference} disabled={busy}>
              Use the testnet reference receipt (batch 5)
            </Button>
          )}
          <label className="tag">
            Upload receipt{" "}
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await run(await f.text());
              }}
            />
          </label>
        </div>
        <textarea
          aria-label="Receipt JSON"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="or paste the receipt JSON here"
        />
        <div style={{ marginTop: 12 }}>
          <Button variant="dark" disabled={busy || !text.trim()} onClick={() => run(text)}>
            Verify
          </Button>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          {`Checked against ${app.escrow} on ${app.network}: the receipt key and anchored hash come from the chain, never from the file. ${LABEL}`}
        </p>
      </Window>

      {error && <p className="bad">{error}</p>}

      {outcome && (
        <Sticker tone={outcome.ok ? "mint" : "rose"}>
          <Eyebrow>Result</Eyebrow>
          <div className="row" style={{ marginBottom: 10 }}>
            {outcome.ok ? (
              <Chip tone="mint">Verified against the chain</Chip>
            ) : (
              <Chip tone="rose">Not verified: the CSV export needs every check to pass</Chip>
            )}
          </div>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {outcome.checks.map((c) => (
              <li key={c.id} className={c.ok ? "" : "bad"} style={{ wordBreak: "break-word" }}>
                {`${c.ok ? "✓" : "✗"} ${CHECK_NAME[c.id]}: ${c.detail}`}
              </li>
            ))}
          </ul>
        </Sticker>
      )}

      {outcome?.ok && r && outcome.hash && (
        <div className="stack">
          <div className="tickets">
            <Ticket label="Payouts" value={String(r.payouts.length)} />
            <Ticket label="Paid to firms" value={formatUsdc(BigInt(r.totals.paid_to_firms))} unit="USDC" />
            <Ticket
              label="Returned to funder"
              value={formatUsdc(BigInt(r.totals.returned_to_funder))}
              unit="USDC"
            />
            <Ticket
              label="Penalties to funder"
              value={formatUsdc(BigInt(r.totals.penalties))}
              unit="USDC"
              tone="peach"
            />
          </div>
          <div>
            <Button
              onClick={() => save(`elivo-batch-${r.batch_id}.csv`, receiptToCsv(r, outcome.hash as string))}
            >
              Download CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
