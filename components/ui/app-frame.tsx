import Link from "next/link";
import type { ReactNode } from "react";

import { ConfigProblem } from "@/components/ui/config-problem";
import { DeploymentBanner } from "@/components/ui/deployment-banner";
import { Logo } from "@/components/ui/logo";
import { NavLinks } from "@/components/ui/nav-links";
import { WalletButton } from "@/components/wallet/wallet-button";
import { configResult } from "@/lib/genlayer/config";

/**
 * The terminal shell: a thin command bar (mark, sections, network, wallet), the
 * page, and a footer that names the contract every value on the page is read
 * from. If the deployment configuration is wrong, nothing else renders.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-amber focus:px-3 focus:py-2 focus:text-graphite">
        Skip to content
      </a>
      <header className="border-b border-hairline bg-charcoal">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="RECON, home">
            <Logo className="h-7 w-7" />
            <span className="mono text-sm font-medium tracking-[0.2em]">RECON</span>
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-3">
            <span className="mono hidden items-center gap-1.5 border border-hairline px-2 py-1 text-[11px] uppercase tracking-wider text-muted md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-support" aria-hidden="true" />
              GenLayer StudioNet
            </span>
            <WalletButton />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {configResult.ok ? (
          <>
            <DeploymentBanner />
            {children}
          </>
        ) : (
          <ConfigProblem problems={configResult.problems} />
        )}
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto grid max-w-7xl gap-2 px-4 py-6 text-xs text-muted sm:px-6">
          <p>
            Every state, result and bond on this site is read from the RECON Intelligent Contract on GenLayer StudioNet.
            This interface holds no key, keeps no database and decides nothing.
          </p>
          {configResult.ok ? (
            <a href={`${configResult.config.explorer}/address/${configResult.config.contractAddress}`} target="_blank"
               rel="noreferrer" className="mono w-fit break-all underline underline-offset-4 hover:text-warm">
              Contract {configResult.config.contractAddress}
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
