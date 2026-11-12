"use client";
import { useEffect, useState } from "react";
import { PayinPanel } from "../../components/PayinPanel.tsx";
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
  const sample = async (name: string) => validate(await (await fetch(`/router/samples/${name}`)).text());

  return (
    <>
      <h1>New payout batch</h1>
      <p className="muted">
        CSV columns: <code>name,clabe,amount_mxn</code>, up to 50 rows. Every CLABE is checked before anything
        goes on-chain.
      </p>
      <p>
        <button type="button" onClick={() => sample("payees.csv")}>
          Use sample
        </button>{" "}
        <button type="button" className="secondary" onClick={() => sample("payees-with-error.csv")}>
          Use sample with a typo
        </button>{" "}
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
      </p>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="or paste CSV here" />
      <p>
        <button type="button" disabled={!csv.trim()} onClick={() => validate(csv)}>
          Validate
        </button>
      </p>
      {error && <p className="bad">{error}</p>}
      {result && <ValidationView result={result} config={config} />}
      {result?.ok && result.total_locked && <PayinPanel totalLockedUnits={result.total_locked} />}
    </>
  );
}
