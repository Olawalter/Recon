import type { ResultKind, Transition } from "@/lib/genlayer/recon";
import { formatTime, resultLabel, stateWords } from "@/lib/formatting/present";

/** Every finalized change of state, oldest first. Nothing is ever overwritten. */
export function StateHistory({ history, kind, unit }: { history: Transition[]; kind: ResultKind; unit?: string }) {
  if (!history.length) return <p className="text-sm text-muted">No state has been finalized yet.</p>;
  return (
    <ol className="grid gap-0">
      {history.map((t, i) => (
        <li key={`${t.result_id}-${t.kind}-${i}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <span className={`mt-1.5 h-2.5 w-2.5 ${t.kind === "EXPIRED" ? "border border-amber" : "bg-amber"}`} aria-hidden="true" />
            {i < history.length - 1 ? <span className="w-px flex-1 bg-hairline" aria-hidden="true" /> : null}
          </div>
          <div className="pb-4">
            <p className="text-sm">
              <span className="text-muted">{t.previous_state ? stateWords(t.previous_state, kind, unit) : "No state"}</span>
              <span className="mx-2 text-muted" aria-hidden="true">→</span>
              <span className="sr-only">became</span>
              <span className="font-semibold">{t.new_state === "EXPIRED" ? "Expired" : stateWords(t.new_state, kind, unit)}</span>
            </p>
            <p className="mono text-[11px] text-muted">
              {t.kind === "EXPIRED" ? "expiry recorded" : `${resultLabel(t.result_id)} finalized`} · {formatTime(t.finalized_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
