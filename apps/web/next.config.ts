import type { NextConfig } from "next";

/**
 * The browser only talks to this server. /rpc is a route handler (view calls only). The router is
 * proxied only for the paths the UI uses (not /sim, /proofs, /exclusions or /orders), and the
 * sandbox demo signer when it is running. The dev server binds to 127.0.0.1 (scripts/lib/web-args.ts).
 */
const ROUTER_PATHS = ["/config", "/samples/:name", "/quote/:path*", "/batches/:path*"];

const config: NextConfig = {
  transpilePackages: ["@elivo/shared"],
  async rewrites() {
    const r: Array<{ source: string; destination: string }> = [];
    const router = process.env.ROUTER_URL;
    if (router) for (const p of ROUTER_PATHS) r.push({ source: `/router${p}`, destination: `${router}${p}` });
    const signer = process.env.DEMO_SIGNER_URL;
    if (signer) r.push({ source: "/demo-signer/:path*", destination: `${signer}/:path*` });
    return r;
  },
};

export default config;
