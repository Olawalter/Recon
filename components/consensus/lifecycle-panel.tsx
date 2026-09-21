import type { ChainTx, Recon, ReconResult } from "@/lib/genlayer/recon";
import { configResult } from "@/lib/genlayer/config";
import { formatTime, shortHash } from "@/lib/formatting/present";

/**
 * The GenLayer lifecycle of one result. Each line names its evidence: the
 * contract's own timestamps, or the observation transaction's own record
 * (its status, consensus outcome and validator votes, as GenLayer stored
 * them). A stage no record shows is not shown as done.
 */

type Line = { stage: string; done: boolean; evidence: string };

export function LifecyclePanel({ recon, result, tx, txLookup }: {
  recon: Recon;
  result?: ReconResult;
  tx?: ChainTx;
  txLookup: "found" | "missing" | "loading" | "failed";
}) {
  const explorer = configResult.ok ? configResult.config.explorer : "";
  const accepted = !!tx && ["ACCEPTED", "FINALIZED", "READY_TO_FINALIZE"].includes(tx.status);
  // A result in contract state exists only because a round was accepted, so a
  // proposal and a vote happened even before the transaction's record is read.
  const implied = !accepted && !!result;
  const votes = tx ? Object.entries(tx.votes).map(([v, n]) => `${n} ${v}`).join(", ") : "";

  const lines: Line[] = [
    { stage: "Requested", done: true, evidence: `Bonded request recorded ${formatTime(recon.created_at)}.` },
    {
      stage: "Observing",
      done: !!result,
      evidence: result ? `Every source fetched by each node at ${formatTime(result.observation_time)}.` : "Not observed yet.",
    },
    {
      stage: "Leader proposed",
      done: accepted || implied,
      evidence: accepted ? "A leader proposed a result; the transaction was later accepted, which requires it."
        : implied ? "The contract holds the result, which requires a leader's proposal. The observation transaction's own record "
          + (txLookup === "loading" || txLookup === "found" ? "is still being read." : "could not be located to show more.")
        : "Not yet.",
    },
    {
      stage: "Validating",
      done: accepted || implied,
      evidence: accepted ? `Validators repeated the work and voted: ${votes || "votes not listed"}.`
        : implied ? "The contract holds the result, which requires the validators' agreement; their votes appear once the transaction is read."
        : "Not yet.",
    },
    {
      stage: "Consensus",
      done: !!result,
      evidence: result
        ? `${tx?.consensus ? `GenLayer recorded ${tx.consensus.toLowerCase().replace(/_/g, " ")}. ` : ""}Result recorded ${formatTime(result.proposed_at)}.`
        : "Not yet.",
    },
    {
      stage: "Finality",
      done: result?.status === "FINALIZED" && tx?.status === "FINALIZED",
      evidence: !result ? "Not yet."
        : `On GenLayer: ${tx ? (tx.status === "FINALIZED" ? "final" : `not final yet (${tx.status.toLowerCase()})`) : "status unavailable"}. `
          + `In the contract: ${result.status === "FINALIZED" ? `final since ${formatTime(result.finalized_at)}` : "pending its finality delay"}.`,
    },
  ];

  return (
    <div className="grid gap-3">
      <ol className="grid gap-2">
        {lines.map((l) => (
          <li key={l.stage} className="grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] items-baseline gap-2 text-sm">
            <span className={`mono text-xs ${l.done ? "text-support" : "text-muted"}`} aria-hidden="true">{l.done ? "✓" : "·"}</span>
            <span className={l.done ? "" : "text-muted"}>
              {l.stage}
              <span className="sr-only">{l.done ? ", done" : ", not yet"}</span>
            </span>
            <span className="text-muted">{l.evidence}</span>
          </li>
        ))}
      </ol>
      {tx ? (
        <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer"
           className="mono w-fit text-[11px] text-muted underline underline-offset-4 hover:text-warm">
          Observation transaction {shortHash(tx.hash)}
        </a>
      ) : txLookup === "failed" ? (
        <p className="text-xs text-muted">StudioNet&apos;s transaction listing did not answer; the contract&apos;s own record above stands.</p>
      ) : null}
    </div>
  );
}
