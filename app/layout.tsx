import type { Metadata } from "next";
import { Instrument_Sans, Martian_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/ui/app-frame";
import { WalletProvider } from "@/lib/wallet/wallet";

import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "RECON: when information conflicts, consensus establishes the state", template: "%s · RECON" },
  description:
    "RECON uses GenLayer to independently reconcile conflicting external evidence and commit the resulting state on-chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${martian.variable}`}>
      <body className="min-h-dvh">
        <WalletProvider>
          <AppFrame>{children}</AppFrame>
        </WalletProvider>
      </body>
    </html>
  );
}
