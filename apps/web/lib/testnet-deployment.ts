/**
 * The public testnet deployment (deployments/testnet.json; a test pins that they match). Built in so the
 * read-only site runs with no configuration: the web app reads no files at run time.
 */
export const TESTNET_DEPLOYMENT = {
  network: "testnet",
  demo_mode: true,
  root: "pg-1794403941.testnet",
  usdc: "usdc.pg-1794403941.testnet",
  escrow: "escrow.pg-1794403941.testnet",
  router: "router.pg-1794403941.testnet",
  firms: {
    mx1: "mx1.pg-1794403941.testnet",
    mx2: "mx2.pg-1794403941.testnet",
    mx3: "mx3.pg-1794403941.testnet",
  },
  council: "council.pg-1794403941.testnet",
  created_at: "2026-11-11T13:36:45Z",
  dao: "elivo-1794414333.sputnikv2.testnet",
  rpcUrl: "https://test.rpc.fastnear.com",
} as const;
