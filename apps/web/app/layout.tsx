import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Banner } from "../components/Banner.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elivo Payout Guard",
  description: "Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Banner />
        <nav>
          <a className="brand" href="/">
            Elivo Payout Guard
          </a>
          <a href="/new">New batch</a>
          <a href="/firms">Firms</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
