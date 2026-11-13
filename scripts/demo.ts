/**
 * make demo          → full batch on a local NEAR sandbox (no accounts, no keys needed)
 * make demo-testnet  → the same flow against the testnet deployment in deployments/testnet.json
 *
 * Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { env } from "@elivo/shared/config";
import { formatUsdc } from "@elivo/shared/money";
import { LABEL } from "@elivo/shared/receipt";
import type { PayoutView } from "@elivo/shared/views";
import { onStop, stopAll } from "./lib/procs.ts";
import { setupSandbox, setupTestnet, startServices } from "./lib/stack.ts";

const network = process.argv.includes("--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : "sandbox";
const e = env({ ...process.env, ELIVO_NETWORK: network });
const short = (id: string | null) => (id ? id.split(".")[0].toUpperCase().replace("MX", "MX-") : "-");
const usdc = (units: string | bigint) => `${formatUsdc(BigInt(units))} USDC`;
let step = 0;
const say = (msg: string) => console.log(`${String(++step).padStart(2)}. ${msg}`);
const note = (msg: string) => console.log(`      ${msg}`);

async function main() {
  console.log(`\nRelevo Payout Guard — demo on ${network}\n${LABEL}\n`);
  const s = network === "testnet" ? await setupTestnet(note) : await setupSandbox();
  onStop(s.stop);
  const { chain, d, keys } = s;
  if (!keys.council) throw new Error("the demo signs the DAO vote with the council key, which is missing");
  const councilKey = keys.council;
  try {
    const { urls } = await startServices(s, network, e);
    say(
      `Services up: router, proof oracle, payout firms MX-1 (22 bps), MX-2 (20 bps), MX-3 (18 bps, configured to be late). Logs in .data/logs/`,
    );

    const postCsv = async (file: string) =>
      (await (
        await fetch(`${urls.router}/batches/validate`, {
          method: "POST",
          headers: { "content-type": "text/csv" },
          body: readFileSync(file, "utf8"),
        })
      ).json()) as {
        ok: boolean;
        errors: Array<{ row: number; reason: string }>;
        draft_id?: string;
        total_locked?: string;
        rows: Array<{ name: string; clabe_last4: string; amount_mxn: string; amount_usdc: string }>;
      };
    const bad = await postCsv("samples/payees-with-error.csv");
    say(
      `CSV with a typo: blocked before the run — ${bad.errors.map((x) => `row ${x.row}: ${x.reason}`).join(", ")}`,
    );
    const v = await postCsv("samples/payees.csv");
    if (!v.ok || !v.draft_id) throw new Error("sample CSV did not validate");
    say(
      `CSV validated: ${v.rows.length} payees, ${usdc(v.total_locked ?? "0")} to lock (amount + 25 bps fee buffer). Only a salted hash and amounts go on-chain.`,
    );
    for (const r of v.rows)
      note(
        `${r.name.padEnd(18)} ****${r.clabe_last4}  ${r.amount_mxn.padStart(10)} MXN  = ${usdc(r.amount_usdc)}`,
      );

    const p = (await (
      await fetch(`${urls.router}/batches/${v.draft_id}/proposal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).json()) as {
      args: object;
      depositYocto: string;
      kind: object;
    };
    const council = chain.signer(d.council, councilKey);
    const added = await council.call(d.dao, "add_proposal", p.args, {
      gasTgas: 100,
      depositYocto: BigInt(p.depositYocto),
    });
    const pid = Number(added.value);
    say(`Sputnik DAO proposal #${pid} created on ${short(d.dao)} ${chain.explorerTx(added.txHash) ?? ""}`);
    const voted = await council.call(
      d.dao,
      "act_proposal",
      { id: pid, action: "VoteApprove", proposal: p.kind },
      { gasTgas: 300 },
    );
    say(
      `Council voted once: USDC locked in the escrow, not with Elivo. ${chain.explorerTx(voted.txHash) ?? ""}`,
    );

    const seen = new Map<number, string>();
    const end = Date.now() + 360_000;
    let status: {
      onchain?: { id: string; receipt_hash: string | null };
      payouts?: PayoutView[];
      anchor_tx?: { hash: string; url: string | null } | null;
    } = {};
    while (Date.now() < end) {
      status = await (await fetch(`${urls.router}/batches/${v.draft_id}`)).json();
      for (const x of status.payouts ?? []) {
        const key = `${x.state}|${x.firm}|${x.excluded}|${x.firms_tried.length}`;
        if (seen.get(x.id) === key) continue;
        const prev = seen.get(x.id);
        seen.set(x.id, key);
        const who = `payout #${x.id} (${usdc(x.amount)})`;
        if (x.state === "Assigned" && x.firms_tried.length === 1 && !x.excluded)
          say(`${who} assigned to ${short(x.firm)} at ${x.quote_bps} bps`);
        else if (x.state === "Assigned" && x.firms_tried.length > 1)
          say(
            `${who}: ${short(x.firms_tried.at(-2) ?? null)} missed its cut-off → rerouted to ${short(x.firm)}; ${short(x.firms_tried.at(-2) ?? null)}'s bond paid ${usdc(x.penalties_total)} to the DAO`,
          );
        else if (x.state === "Assigned" && x.excluded)
          say(`${who}: bank reports ACCOUNT_CLOSED (signed exclusion) → no penalty`);
        else if (x.state === "Delivered")
          say(
            `${who} delivered by ${short(x.firm)} — signed proof ${x.proof_ref}${x.firms_tried.length > 1 ? " (after reroute)" : " (on time)"}`,
          );
        else if (x.state === "Refunded")
          say(
            `${who} refunded to the DAO in full${prev?.includes("true") || x.excluded ? " (account closed)" : ""}`,
          );
      }
      if (status.onchain?.receipt_hash) break;
      await new Promise((r) => setTimeout(r, network === "testnet" ? 5_000 : 1_000));
    }
    if (!status.onchain?.receipt_hash)
      throw new Error("batch did not complete in time; see .data/logs/router.log");
    say(
      `Receipt signed and its hash anchored on-chain: ${status.onchain.receipt_hash} ${status.anchor_tx?.url ?? ""}`,
    );

    const receipt = await (await fetch(`${urls.router}/batches/${v.draft_id}/receipt`)).json();
    mkdirSync(".data/receipts", { recursive: true });
    const rfile = `.data/receipts/${network}-batch-${status.onchain.id}.json`;
    writeFileSync(rfile, `${JSON.stringify(receipt, null, 2)}\n`);
    const verify = (file: string): string => {
      try {
        return execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "packages/shared/src/bin/verify-receipt.ts",
            file,
            "--chain",
            "--rpc",
            chain.opts.rpcUrl,
            "--escrow",
            d.escrow,
          ],
          { encoding: "utf8", stdio: "pipe" },
        ).trim();
      } catch (err) {
        return String((err as { stdout?: string }).stdout ?? "").trim() || "FAIL: error";
      }
    };
    const out = verify(rfile);
    say(`verify-receipt ${rfile} --chain → ${out}`);
    const tampered = { ...receipt, totals: { ...receipt.totals, penalties: "0" } };
    writeFileSync(`${rfile}.edited`, JSON.stringify(tampered));
    const editedOut = verify(`${rfile}.edited`);
    say(`Same receipt with one number edited → ${editedOut || "(unexpectedly accepted)"}`);

    // Outcome checks (same as the end-to-end test).
    const ps = status.payouts ?? [];
    const mx3 = d.firms.mx3;
    const checks: Array<[string, boolean]> = [
      [
        "exactly one refund, the closed account, no penalty",
        ps.filter((x) => x.state === "Refunded").length === 1 &&
          ps.some((x) => x.state === "Refunded" && x.excluded && x.penalties_total === "0"),
      ],
      [
        "an on-time delivery by MX-1 or MX-2",
        ps.some((x) => x.state === "Delivered" && x.firms_tried.length === 1 && x.firm !== mx3),
      ],
      [
        "a reroute away from MX-3 with a penalty",
        ps.some(
          (x) => x.firms_tried[0] === mx3 && x.firms_tried.length > 1 && BigInt(x.penalties_total) > 0n,
        ),
      ],
      ["verify-receipt OK on the real receipt", out === "OK"],
      ["verify-receipt FAIL on an edited receipt", editedOut.startsWith("FAIL")],
    ];
    const penalties = ps.reduce((sum, x) => sum + BigInt(x.penalties_total), 0n);
    console.log(
      `\nPenalties paid by late firms to the DAO: ${usdc(penalties)} (1 bp per period late; demo period = 10 s standing in for 1 hour)`,
    );
    for (const [name, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!checks.every(([, ok]) => ok)) process.exitCode = 1;
    console.log(`\n${LABEL}\n`);
  } finally {
    stopAll();
    await s.stop();
  }
}

main().catch((err) => {
  console.error(`demo failed: ${(err as Error).message}`);
  stopAll();
  process.exit(1);
});
