import { describe, expect, it } from "vitest";
import { onStop, shutdown } from "../lib/procs.ts";

describe("shutdown", () => {
  it("runs every stop hook once, even when one throws (the failure path of pnpm dev)", async () => {
    const ran: string[] = [];
    onStop(() => {
      ran.push("sandbox");
    });
    onStop(() => {
      throw new Error("already gone");
    });
    onStop(async () => {
      ran.push("signer");
    });
    await shutdown();
    await shutdown();
    expect(ran).toEqual(["sandbox", "signer"]);
  });
});
