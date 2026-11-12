import { keyFromSeed, verify } from "@elivo/shared/keys";
import { quoteMessage } from "@elivo/shared/messages";
import { describe, expect, it } from "vitest";
import { createFirm, type FirmDeps } from "../src/firm.ts";

const ESCROW = "escrow.test.near";
const key = keyFromSeed(new Uint8Array(32).fill(5));
const CLOSED = "012180001234567899";
const OPEN = "002010077777777771";

function setup(mode: FirmDeps["mode"], over: Partial<FirmDeps> = {}) {
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  const delivered: unknown[] = [];
  const excluded: unknown[] = [];
  const deps: FirmDeps = {
    firmId: "mx3.test.near",
    escrowId: ESCROW,
    key,
    quoteBps: 18,
    mode,
    graceMs: 5_000,
    closedClabes: new Set([CLOSED]),
    oracle: {
      deliver: async (b) => {
        delivered.push(b);
      },
      exclude: async (b) => {
        excluded.push(b);
      },
    },
    schedule: (ms, fn) => scheduled.push({ ms, fn }),
    random: () => 0.5,
    ...over,
  };
  return { app: createFirm(deps), scheduled, delivered, excluded };
}

const order = (clabe = OPEN) => ({
  batch_id: "3",
  payout_id: 1,
  clabe,
  amount_mxn: "37000.00",
  cutoff_ms: 40_000,
});
const runAll = async (s: Array<{ fn: () => void }>) => {
  for (const x of s) await x.fn();
};

describe("firm simulator", () => {
  it("quote is signed", async () => {
    const { app } = setup("ok");
    const res = await app.inject({
      method: "POST",
      url: "/quote",
      payload: { batch_id: "3", payout_id: 1, amount: "2000000000" },
    });
    const q = res.json();
    expect(q).toMatchObject({ firm_id: "mx3.test.near", quote_bps: 18 });
    const msg = quoteMessage(ESCROW, { batch_id: 3n, payout_id: 1, firm_id: "mx3.test.near", quote_bps: 18 });
    expect(verify(key.publicKey, msg, Buffer.from(q.quote_sig, "base64"))).toBe(true);
  });

  it("ok mode delivers within 4s", async () => {
    const { app, scheduled, delivered } = setup("ok");
    expect((await app.inject({ method: "POST", url: "/orders", payload: order() })).statusCode).toBe(202);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBeGreaterThanOrEqual(2_000);
    expect(scheduled[0].ms).toBeLessThanOrEqual(4_000);
    await runAll(scheduled);
    expect(delivered).toEqual([{ batch_id: "3", payout_id: 1, firm_id: "mx3.test.near" }]);
  });

  it("late mode delivers after cutoff plus grace", async () => {
    const { app, scheduled } = setup("late");
    await app.inject({ method: "POST", url: "/orders", payload: order() });
    expect(scheduled[0].ms).toBe(40_000 + 5_000 + 20_000);
  });

  it("fail mode never delivers", async () => {
    const { app, scheduled } = setup("fail");
    await app.inject({ method: "POST", url: "/orders", payload: order() });
    expect(scheduled).toHaveLength(0);
  });

  it("closed account is excluded not delivered", async () => {
    const { app, scheduled, delivered, excluded } = setup("ok");
    await app.inject({ method: "POST", url: "/orders", payload: order(CLOSED) });
    expect(scheduled[0].ms).toBe(1_500);
    await runAll(scheduled);
    expect(delivered).toHaveLength(0);
    expect(excluded).toEqual([
      { batch_id: "3", payout_id: 1, firm_id: "mx3.test.near", reason: "ACCOUNT_CLOSED" },
    ]);
  });

  it("mode switch applies to new orders", async () => {
    const { app, scheduled } = setup("ok");
    expect((await app.inject({ method: "POST", url: "/mode", payload: { mode: "fail" } })).json()).toEqual({
      mode: "fail",
    });
    await app.inject({ method: "POST", url: "/orders", payload: order() });
    expect(scheduled).toHaveLength(0);
    expect(
      (await app.inject({ method: "POST", url: "/mode", payload: { mode: "sideways" } })).statusCode,
    ).toBe(400);
  });

  it("oracle 409 is swallowed", async () => {
    const { app, scheduled } = setup("ok", {
      oracle: {
        deliver: async () => {
          throw new Error("409 not_current_firm");
        },
        exclude: async () => {},
      },
    });
    await app.inject({ method: "POST", url: "/orders", payload: order() });
    await expect(runAll(scheduled)).resolves.toBeUndefined();
  });

  it("does not echo the CLABE back", async () => {
    const { app } = setup("ok");
    const res = await app.inject({ method: "POST", url: "/orders", payload: order() });
    expect(res.body).not.toContain(OPEN);
  });
});

describe("firm delivery retries", () => {
  it("retries a delivery the oracle could not process (5xx), not one it refused (409)", async () => {
    let attempts = 0;
    const { app, scheduled } = setup("ok", {
      oracle: {
        deliver: async () => {
          attempts++;
          if (attempts < 3) throw new Error("500 Internal Server Error");
        },
        exclude: async () => {},
      },
    });
    await app.inject({ method: "POST", url: "/orders", payload: order() });
    for (let i = 0; i < scheduled.length; i++) await scheduled[i].fn(); // retries are scheduled too
    expect(attempts).toBe(3);

    let refused = 0;
    const s2 = setup("ok", {
      oracle: {
        deliver: async () => {
          refused++;
          throw new Error("409 not_current_firm");
        },
        exclude: async () => {},
      },
    });
    await s2.app.inject({ method: "POST", url: "/orders", payload: order() });
    for (let i = 0; i < s2.scheduled.length; i++) await s2.scheduled[i].fn();
    expect(refused).toBe(1);
  });
});
