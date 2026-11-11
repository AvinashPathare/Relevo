/** Firm process: FIRM=mx1|mx2|mx3, FIRM_ACCOUNT, FIRM_SECRET_KEY, FIRM_MODE, ESCROW_ID, ORACLE_URL. */
import { readFileSync } from "node:fs";
import { env } from "@elivo/shared/config";
import { keyFromSecret } from "@elivo/shared/keys";
import { createFirm, type Mode } from "./firm.ts";

const QUOTES = { mx1: 22, mx2: 20, mx3: 18 } as const;
const DEFAULT_MODES: Record<string, Mode> = { mx1: "ok", mx2: "ok", mx3: "late" };

const e = env();
const need = (k: string) => process.env[k] ?? (console.error(`missing ${k}`), process.exit(2));
const firm = need("FIRM") as keyof typeof QUOTES;
const oracleUrl = need("ORACLE_URL");
const closed: string[] = JSON.parse(
  readFileSync(new URL("../closed-accounts.json", import.meta.url), "utf8"),
);

async function post(path: string, body: object) {
  const r = await fetch(`${oracleUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

const app = createFirm({
  firmId: need("FIRM_ACCOUNT"),
  escrowId: need("ESCROW_ID"),
  key: keyFromSecret(need("FIRM_SECRET_KEY")),
  quoteBps: QUOTES[firm],
  mode: (process.env.FIRM_MODE as Mode) ?? DEFAULT_MODES[firm],
  graceMs: e.graceMs,
  closedClabes: new Set(closed),
  oracle: { deliver: (b) => post("/deliveries", b), exclude: (b) => post("/exclusions", b) },
  log: (m) => console.log(m),
});
await app.listen({ host: "127.0.0.1", port: e.firmPorts[firm] });
console.log(`${firm} listening on 127.0.0.1:${e.firmPorts[firm]}`);
