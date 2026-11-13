import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { GET } from "../app/api/config/route.ts";

const d = {
  network: "sandbox",
  rpcUrl: "http://127.0.0.1:3030",
  usdc: "usdc.t",
  escrow: "escrow.t",
  router: "router.t",
  firms: { mx1: "mx1.t", mx2: "mx2.t", mx3: "mx3.t" },
  council: "council.t",
  dao: "dao.t",
};
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

it("serves the deployment from ELIVO_DEPLOYMENT_JSON without touching the filesystem", async () => {
  process.env.ELIVO_DEPLOYMENT_JSON = JSON.stringify(d);
  process.env.DEMO_SIGNER_URL = "http://127.0.0.1:7430";
  process.env.ROUTER_URL = "http://127.0.0.1:7400";
  const r = await GET().json();
  expect(r).toMatchObject({
    network: "sandbox",
    escrow: "escrow.t",
    signer: "demo",
    routerAvailable: true,
    rpcUrl: d.rpcUrl,
  });
});

it("with nothing configured, serves the public testnet deployment, read-only", async () => {
  delete process.env.ELIVO_DEPLOYMENT_JSON;
  delete process.env.ROUTER_URL;
  delete process.env.DEMO_SIGNER_URL;
  delete process.env.NEAR_RPC_URL;
  const r = GET();
  expect(r.status).toBe(200);
  const file = JSON.parse(readFileSync("deployments/testnet.json", "utf8"));
  expect(await r.json()).toMatchObject({
    network: "testnet",
    escrow: file.escrow,
    signer: "wallet",
    routerAvailable: false,
    rpcUrl: file.rpcUrl,
  });
});
