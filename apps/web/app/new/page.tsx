"use client";
import { useEffect, useState } from "react";
import { PayinPanel } from "../../components/PayinPanel.tsx";
import { Button, Eyebrow, Steps, Window } from "../../components/ui.tsx";
import {
  type RouterConfig,
  type ValidateResponse,
  ValidationView,
} from "../../components/ValidationView.tsx";

export default function NewBatchPage() {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ValidateResponse | null>(null);
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/router/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`router: HTTP ${r.status}`))))
      .then(setConfig)
      .catch(() => setError("The router is not running. Start the app with pnpm dev."));
  }, []);

  const validate = async (text: string) => {
    setCsv(text);
    setResult(null);
    setError(null);
    try {
      const r = await fetch("/router/batches/validate", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: text,
      });
      if (r.status !== 200 && r.status !== 422) throw new Error(`router: HTTP ${r.status}`);
      setResult((await r.json()) as ValidateResponse);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const sample = async (name: string) => {
    setError(null);
    let text: string;
    try {
      const r = await fetch(`/router/samples/${name}`);
      if (!r.ok) {
        setError(`Could not load the sample: router HTTP ${r.status}`);
        return;
      }
      text = await r.text();
    } catch {
      setError("Could not load the sample: the router is not running. Start the app with pnpm dev.");
      return;
    }
    await validate(text);
  };

  return (
    <div className="stack">
      <Steps current={result?.ok ? 2 : 1} />
      <div>
        <Eyebrow>01 · Upload</Eyebrow>
        <h1 className="page-title">New payout batch</h1>
        <p className="lede">
          CSV columns: <code>name,clabe,amount_mxn</code>, up to 50 rows. Every CLABE is checked before
          anything goes on-chain.
        </p>
      </div>
      <Window title="~/new" status={result ? (result.ok ? "done" : "offline") : "idle"}>
        <div className="row" style={{ marginBottom: 14 }}>
          <Button onClick={() => sample("payees.csv")}>Use sample</Button>
          <Button variant="secondary" onClick={() => sample("payees-with-error.csv")}>
            Use sample with a typo
          </Button>
          <label className="tag">
            Upload CSV{" "}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await validate(await f.text());
              }}
            />
          </label>
        </div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="or paste CSV here" />
        <div style={{ marginTop: 12 }}>
          <Button variant="dark" disabled={!csv.trim()} onClick={() => validate(csv)}>
            Validate
          </Button>
        </div>
      </Window>
      {error && <p className="bad">{error}</p>}
      {result && (
        <div className="stack">
          {result.ok && <Eyebrow>02 · Quote</Eyebrow>}
          <ValidationView result={result} config={config} />
        </div>
      )}
      {result?.ok && result.total_locked && <PayinPanel totalLockedUnits={result.total_locked} />}
    </div>
  );
}
