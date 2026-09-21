"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { configResult } from "@/lib/genlayer/config";
import { shortAddress } from "@/lib/formatting/present";
import { useWallet } from "@/lib/wallet/wallet";

/**
 * Connect, disconnect, network mismatch, and the wallet chooser. Wallets are
 * listed by the name each announces through EIP-6963 (MetaMask, Rabby, Trust
 * Wallet and any other); RECON never asks for, sees or stores a key.
 */
export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const want = configResult.ok ? configResult.config.chainId : undefined;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (wallet.status === "connected" && wallet.account) {
    const wrongNetwork = want !== undefined && wallet.chainId !== want;
    return (
      <div className="flex items-center gap-2">
        {wrongNetwork ? (
          <button type="button" className="btn border-conflict px-2.5 py-1.5 text-xs text-conflict" onClick={wallet.switchNetwork}>
            Wrong network: switch to StudioNet
          </button>
        ) : null}
        <span className="mono hidden text-xs text-muted sm:inline" title={wallet.account}>
          {shortAddress(wallet.account)}
        </span>
        <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={wallet.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-primary px-3 py-1.5" disabled={wallet.status === "connecting"}
              onClick={() => setOpen(true)}>
        {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="wallet-title"
        className="m-auto w-[min(420px,92vw)] border border-edge bg-charcoal p-0 text-warm backdrop:bg-black/60"
      >
        <div className="pane-title">
          <span className="index">◆</span>
          <span id="wallet-title">Connect a wallet</span>
        </div>
        <div className="grid gap-4 p-5">
          <p className="text-sm text-muted">
            RECON signs with your own browser wallet. It never asks for, sees or stores a private key.
          </p>
          {wallet.wallets.length === 0 ? (
            <p className="border border-hairline bg-graphite p-4 text-sm text-muted">
              No browser wallet was found. Install MetaMask, Rabby, Trust Wallet or another injected wallet, then reload
              this page.
            </p>
          ) : (
            <ul className="grid gap-2">
              {wallet.wallets.map((w) => (
                <li key={w.info.uuid}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 border border-edge bg-graphite px-4 py-3 text-left text-sm hover:border-amber"
                    onClick={async () => {
                      await wallet.connect(w);
                      setOpen(false);
                    }}
                  >
                    {w.info.icon ? (
                      <Image src={w.info.icon} alt="" width={24} height={24} unoptimized />
                    ) : (
                      <span className="h-6 w-6 border border-edge" aria-hidden="true" />
                    )}
                    <span>{w.info.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {wallet.error ? <p role="alert" className="text-sm text-conflict">{wallet.error}</p> : null}
          <button type="button" className="justify-self-start text-sm text-muted underline underline-offset-4 hover:text-warm"
                  onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
