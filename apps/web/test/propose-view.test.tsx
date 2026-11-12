import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProposeView } from "../components/ProposeView.tsx";
import type { Signer } from "../lib/signer.ts";

afterEach(cleanup);

const signer = (over: Partial<Signer> = {}): Signer => ({
  mode: "wallet",
  accountId: "someone.testnet",
  signIn: vi.fn(async () => {}),
  propose: vi.fn(async () => {}),
  approve: vi.fn(async () => {}),
  ...over,
});
const pending = { id: 4, status: "InProgress", kind: { FunctionCall: {} }, proposer: "x", votes: {} };

it("offers to create the proposal when there is none", () => {
  const s = signer();
  render(<ProposeView draftId="d1" proposal={null} council={[]} signer={s} funded={false} />);
  expect(screen.getByText("No DAO proposal yet")).toBeTruthy();
  fireEvent.click(screen.getByText("Create DAO proposal"));
  expect(s.propose).toHaveBeenCalledWith("d1");
});

it("disables approval for an account outside the council", () => {
  render(
    <ProposeView
      draftId="d1"
      proposal={pending}
      council={["council.testnet"]}
      signer={signer()}
      funded={false}
    />,
  );
  expect(screen.getByText("Proposal #4: waiting for the council's vote")).toBeTruthy();
  expect((screen.getByText("Approve as council") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Only council members can approve")).toBeTruthy();
});

it("lets a council member approve", () => {
  const s = signer({ accountId: "council.testnet" });
  render(
    <ProposeView draftId="d1" proposal={pending} council={["council.testnet"]} signer={s} funded={false} />,
  );
  fireEvent.click(screen.getByText("Approve as council"));
  expect(s.approve).toHaveBeenCalledWith(pending);
});

it("labels the demo signer", () => {
  render(
    <ProposeView
      draftId="d1"
      proposal={null}
      council={[]}
      signer={signer({ mode: "demo", accountId: "council.sandbox" })}
      funded={false}
    />,
  );
  expect(screen.getByText("Demo signer: local sandbox keys, not a wallet")).toBeTruthy();
});

it("waits for the escrow after approval, and collapses once funded", () => {
  const { rerender } = render(
    <ProposeView
      draftId="d1"
      proposal={{ ...pending, status: "Approved" }}
      council={[]}
      signer={signer()}
      funded={false}
    />,
  );
  expect(screen.getByText("Approved: waiting for the escrow to record the batch")).toBeTruthy();
  rerender(
    <ProposeView
      draftId="d1"
      proposal={{ ...pending, status: "Approved" }}
      council={[]}
      signer={signer()}
      funded
    />,
  );
  expect(screen.getByText("DAO proposal #4 approved; the batch is funded.")).toBeTruthy();
});
