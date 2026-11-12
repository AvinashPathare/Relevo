import type { NextConfig } from "next";

/**
 * The browser only talks to this server: /rpc → NEAR RPC, /router/* → router, /demo-signer/* →
 * the sandbox demo signer. No CORS, and the same code runs on sandbox and testnet.
 */
const config: NextConfig = {
  transpilePackages: ["@elivo/shared"],
  async rewrites() {
    const r: Array<{ source: string; destination: string }> = [];
    if (process.env.NEAR_RPC_URL) r.push({ source: "/rpc", destination: process.env.NEAR_RPC_URL });
    if (process.env.ROUTER_URL)
      r.push({ source: "/router/:path*", destination: `${process.env.ROUTER_URL}/:path*` });
    if (process.env.DEMO_SIGNER_URL)
      r.push({ source: "/demo-signer/:path*", destination: `${process.env.DEMO_SIGNER_URL}/:path*` });
    return r;
  },
};

export default config;
