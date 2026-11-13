import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TESTNET_DEPLOYMENT } from "../lib/testnet-deployment.ts";

it("the built-in testnet deployment is deployments/testnet.json", () => {
  const file = JSON.parse(readFileSync("deployments/testnet.json", "utf8"));
  expect(TESTNET_DEPLOYMENT).toEqual(file);
});
