"use client";

import { useState } from "react";

import { TxTracker } from "@/components/consensus/tx-tracker";
import { actsFor, type Act } from "@/lib/genlayer/acts";
import { useNow, useRecon, useSend } from "@/lib/genlayer/hooks";
import { reconChanged, verbCall, type Recon, type ReconResult } from "@/lib/genlayer/recon";
import { useWallet } from "@/lib/wallet/wallet";

/**
 * What can be done to this request now, with the reason when something cannot.
 * Every act is a transaction the contract checks again; the caller never gains
 * anything or chooses an outcome, so most acts are open to anyone.
 */
export function ActsPanel({ recon, latest, onChanged }: { recon: Recon; latest?: ReconResult; onChanged: () => void }) {
  const now = useNow(10_000);
  const wallet = useWallet();
  const { client, config } = useRecon();
  const sender = useSend();
  const [active, setActive] = useState<Act | null>(null);
  const acts = actsFor(recon, latest, now, wallet.account);
  const available = acts.filter((a) => a.available);
  const waiting = acts.filter((a) => !a.available);

  const run = async (act: Act) => {
    setActive(act);
    const before = { status: recon.status, count: recon.result_count, state: recon.current_state, bond: recon.bond_status };
    const test = (r: Recon) => {
      switch (act.method) {
        case "observe_recon": return r.result_count > before.count;
        case "finalize_result": return r.status === "FINALIZED";
        case "expire_result": return r.current_state === "EXPIRED";
        case "close_recon": return r.status === "CLOSED" || r.status === "FAILED";
        case "refund_bond": return r.bond_status === "REFUNDED";
        case "cancel_recon": return r.status === "CANCELLED";
      }
    };
    await sender.send({ call: verbCall(act.method, recon.recon_id), reconciled: reconChanged(client, config, recon.recon_id, test),
                        onSettled: onChanged });
  };

  return (
    <div className="grid gap-4">
      {available.length === 0 ? (
        <p className="text-sm text-muted">Nothing can be done to this request at the moment. The list below says why.</p>
      ) : (
        <ul className="grid gap-3">
          {available.map((a) => (
            <li key={a.method} className="grid gap-2 border border-hairline bg-graphite p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="text-xs text-muted">{a.explains}{a.permissionless ? " Anyone may send this." : ""}</p>
              </div>
              <button type="button" className={`btn justify-self-start ${a.method === "observe_recon" ? "btn-primary" : ""}`}
                      disabled={sender.busy || !wallet.account} onClick={() => run(a)}>
                {sender.busy && active?.method === a.method ? "Sending…" : a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!wallet.account && available.length ? <p className="text-xs text-muted">Connect a wallet to send a transaction.</p> : null}

      {active ? <TxTracker state={sender.state} done={`${active.label}: recorded in the contract.`}
                             leader={active.method === "observe_recon" ? "A leader is fetching every source and proposing a result." : undefined} /> : null}

      {waiting.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-warm">Not available yet ({waiting.length})</summary>
          <ul className="mt-2 grid gap-1.5 pl-1">
            {waiting.map((a) => (
              <li key={a.method}>
                <span>{a.label}</span>
                <span className="text-muted">: {a.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
