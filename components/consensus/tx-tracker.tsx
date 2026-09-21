import { configResult } from "@/lib/genlayer/config";
import { rungsFor, type Step, type TxState } from "@/lib/genlayer/tx";
import { shortHash } from "@/lib/formatting/present";

/**
 * A write, step by step. A step is ticked only when the thing it names has
 * happened; a step GenLayer passed between two status reads is shown as
 * passed, not as observed. The statuses actually read are listed as read.
 */

const LABEL: Record<Step, string> = {
  WALLET_CONFIRMATION: "Wallet confirmation",
  SUBMITTED: "Submitted",
  PENDING: "Pending",
  LEADER_PROPOSED: "Leader proposed",
  VALIDATING: "Validating",
  CONSENSUS: "Consensus",
  FINALIZED: "Finalized",
};

const WAITING: Record<Step, string> = {
  WALLET_CONFIRMATION: "Confirm the transaction in your wallet.",
  SUBMITTED: "Waiting for GenLayer to receive it.",
  PENDING: "Waiting for GenLayer to schedule it.",
  LEADER_PROPOSED: "A leader is executing it and proposing the outcome.",
  VALIDATING: "Validators are repeating the work themselves and voting.",
  CONSENSUS: "Accepted; checking that the contract's own state shows it.",
  FINALIZED: "Recorded. It becomes final when GenLayer's appeal window closes.",
};

/** `leader` replaces the leader step's generic words where the act says more:
 * only an observation fetches sources. */
export function TxTracker({ state, done, leader }: { state: TxState; done?: string; leader?: string }) {
  if (state.phase === "READY") return null;
  const explorer = configResult.ok ? configResult.config.explorer : "";
  return (
    <div className="grid gap-3 border border-hairline bg-graphite p-4" aria-live="polite">
      <ol className="grid gap-1.5 text-sm">
        {rungsFor(state).map(({ step, state: s }) => (
          <li key={step} className="flex items-baseline gap-2.5">
            <span className={`mono w-4 text-center text-xs ${s === "failed" ? "text-conflict" : s === "observed" ? "text-support"
              : s === "passed" ? "text-muted" : s === "current" ? "text-amber" : "text-edge-strong"}`} aria-hidden="true">
              {s === "failed" ? "✕" : s === "observed" ? "✓" : s === "passed" ? "✓" : s === "current" ? "›" : "·"}
            </span>
            <span className={s === "todo" ? "text-muted" : s === "failed" ? "text-conflict" : ""}>
              {LABEL[step]}
              <span className="sr-only">
                {s === "observed" ? ", done" : s === "passed" ? ", passed between two status reads" : s === "current"
                  ? ", in progress" : s === "failed" ? ", failed" : ", not yet"}
              </span>
              {s === "passed" ? <span className="ml-2 text-xs text-muted" aria-hidden="true">passed between reads</span> : null}
              {s === "current" ? <span className="block text-xs text-muted">{step === "LEADER_PROPOSED" && leader ? leader : WAITING[step]}</span> : null}
            </span>
          </li>
        ))}
      </ol>

      {state.phase === "FAILED" && state.message ? (
        <p role="alert" className="border-l-2 border-conflict pl-3 text-sm">{state.message}</p>
      ) : null}
      {state.happened >= 6 && done ? <p className="border-l-2 border-support pl-3 text-sm">{done}</p> : null}

      {state.hash ? (
        <p className="mono grid gap-0.5 text-[11px] text-muted">
          <a href={`${explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="w-fit underline underline-offset-4 hover:text-warm">
            Transaction {shortHash(state.hash)}
          </a>
          {state.statuses.length ? <span>GenLayer statuses read: {state.statuses.join(" → ").toLowerCase()}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
