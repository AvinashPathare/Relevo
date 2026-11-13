import "@fontsource-variable/unbounded";
import "@fontsource-variable/dm-sans";
import "@fontsource/jetbrains-mono/500.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "../components/Banner.tsx";
import { Logo } from "../components/Logo.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relevo Payout Guard",
  description: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.",
};

/** Network from the deployment the dev server was started with (server-side env; no file reads). */
function network(): string | null {
  try {
    return (
      (JSON.parse(process.env.ELIVO_DEPLOYMENT_JSON ?? "null") as { network?: string } | null)?.network ??
      null
    );
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const net = network();
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
              <a href="/new">New batch</a>
              <a href="/firms">Firms</a>
              <a href="/verify">Verify</a>
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
