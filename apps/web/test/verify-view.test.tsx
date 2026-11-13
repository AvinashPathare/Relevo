import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVectors } from "../../../scripts/lib/receipt-vectors.ts";
import { VerifyView } from "../components/VerifyView.tsx";
import type { VerifyOutcome } from "../lib/verify.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { files, manifest } = buildVectors();
const receipt = JSON.parse(files["valid.json"]);
const app = { escrow: "escrow.example.testnet", network: "testnet" as const };
const passing: VerifyOutcome = {
  receipt,
  hash: manifest[0].receipt_hash,
  ok: true,
  checks: [
    { id: "escrow", ok: true, detail: "For escrow.example.testnet on testnet, the escrow this app uses" },
    { id: "signature", ok: true, detail: "Signed by the batch's receipt key on-chain, ed25519:K" },
    { id: "anchor", ok: true, detail: "Hash H matches the hash anchored on-chain" },
    { id: "totals", ok: true, detail: "Totals add up from the 3 payout rows" },
  ],
};
const failing: VerifyOutcome = {
  ...passing,
  ok: false,
  checks: [
    passing.checks[0],
    {
      id: "signature",
      ok: false,
      detail: "The signature does not match the contents: the file was changed after signing",
    },
    ...passing.checks.slice(2),
  ],
};

function paste(text: string) {
  fireEvent.change(screen.getByLabelText("Receipt JSON"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
}

describe("VerifyView", () => {
  it("lists each passing check and offers the CSV", async () => {
    const saved: Array<{ name: string; text: string }> = [];
    render(
      <VerifyView app={app} verify={async () => passing} save={(name, text) => saved.push({ name, text })} />,
    );
    paste(files["valid.json"]);
    expect(
      await screen.findByText("✓ Signature: Signed by the batch's receipt key on-chain, ed25519:K"),
    ).toBeTruthy();
    expect(screen.getByText("✓ Anchored on-chain: Hash H matches the hash anchored on-chain")).toBeTruthy();
    expect(screen.getByText("Verified against the chain")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(saved[0].name).toBe("elivo-batch-7.csv");
    expect(saved[0].text.startsWith("batch_id,network,escrow,receipt_hash,")).toBe(true);
    expect(saved[0].text).toContain(manifest[0].receipt_hash as string);
  });

  it("names the failing check and offers no CSV", async () => {
    render(<VerifyView app={app} verify={async () => failing} save={() => {}} />);
    paste(files["edited-amount.json"]);
    expect(
      await screen.findByText(
        "✗ Signature: The signature does not match the contents: the file was changed after signing",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Not verified: the CSV export needs every check to pass")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("verifies the testnet reference receipt on testnet only", async () => {
    const verify = vi.fn(async () => passing);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/receipts/testnet-batch-5.json"
          ? new Response(files["valid.json"])
          : new Response("", { status: 404 }),
      ),
    );
    const { unmount } = render(<VerifyView app={app} verify={verify} save={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Use the testnet reference receipt (batch 5)" }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith(files["valid.json"]));
    unmount();
    render(<VerifyView app={{ ...app, network: "sandbox" }} verify={verify} save={() => {}} />);
    expect(screen.queryByRole("button", { name: /testnet reference receipt/ })).toBeNull();
  });

  it("carries the testnet label", () => {
    render(<VerifyView app={app} verify={async () => passing} save={() => {}} />);
    expect(
      screen.getByText(
        /Testnet prototype\. Payout firms and SPEI receipts are simulated\. Contract unaudited\./,
      ),
    ).toBeTruthy();
  });
});
