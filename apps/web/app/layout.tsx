import "@fontsource-variable/unbounded";
import "@fontsource-variable/dm-sans";
import "@fontsource/jetbrains-mono/500.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "../components/Banner.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elivo Payout Guard",
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

function Glyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M4 11a7 7 0 0 1 12.1-4.8" fill="none" stroke="#17152b" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M18 11a7 7 0 0 1-12.1 4.8"
        fill="none"
        stroke="#5b45d6"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const net = network();
  return (
    <html lang="en">
      <body>
        <Banner />
        <div className="nav-wrap">
          <nav className="nav">
            <a className="brand" href="/">
              <Glyph />
              <span>Elivo Payout Guard</span>
            </a>
            <div className="nav-links">
              <a href="/new">New batch</a>
              <a href="/firms">Firms</a>
            </div>
            {net && <span className="pill-label">{net}</span>}
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
