import "@fontsource-variable/unbounded";
import "@fontsource-variable/dm-sans";
import "@fontsource/jetbrains-mono/500.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "../components/Banner.tsx";
import { Logo } from "../components/Logo.tsx";
import { deployment, navLinks, routerAvailable } from "../lib/deployment.ts";
import "./globals.css";

/** Read the deployment and router settings per request, not once at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relevo Payout Guard",
  description: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const net = deployment().network;
  return (
    <html lang="en">
      <body>
        <div className="nav-wrap">
          <Banner />
          <nav className="nav">
            <a className="brand" href="/">
              <Logo />
              <span>Payout Guard</span>
            </a>
            <div className="nav-links">
              {navLinks(routerAvailable()).map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
            {net && <span className="net">{net}</span>}
          </nav>
        </div>
        <main className="shell">{children}</main>
        <footer className="footer">
          Apache-2.0 · NEAR testnet prototype · mock USDC · simulated payout firms and SPEI receipts.
        </footer>
      </body>
    </html>
  );
}
