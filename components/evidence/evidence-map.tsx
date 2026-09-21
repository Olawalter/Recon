import { EvidenceChip, FreshnessChip, ReconciliationChip } from "@/components/recon/chips";
import { hostLabel } from "@/components/conflict-graph/conflict-graph";
import type { EvidenceReport, ReconResult } from "@/lib/genlayer/recon";
import { FRESHNESS, POLICY, SOURCE_CLASS, formatDay, formatTime, stateWords } from "@/lib/formatting/present";

/**
 * The Evidence Map: question, each source and the claim it was recorded as
 * making, then the conflict analysis, the policy and the result. Every line is
 * a field of the recorded result. Only structured evidence is shown: the
 * passage a claim rests on, never any model's reasoning.
 */
export function EvidenceMap({ result, question }: { result: ReconResult; question: string }) {
  const rt = result.result_type;
  return (
    <ol className="grid gap-0" aria-label="Evidence map">
      <Step marker="Q" title="Question">
        <p className="text-sm">{question}</p>
      </Step>

      {result.evidence.map((e) => (
        <Step key={e.source_id} marker={e.source_id} title={hostLabel(e.source_url)} nested>
          <SourceBody e={e} kind={rt.kind} unit={rt.unit} />
        </Step>
      ))}

      <Step marker="≠" title="Conflict analysis">
        <p className="text-sm text-muted">
          Sources are counted by publisher, not by address. {result.groups.length} independent{" "}
          {result.groups.length === 1 ? "publisher" : "publishers"} made a counted claim:
        </p>
        <ul className="mt-2 grid gap-1 text-sm">
          {result.groups.map((g) => (
            <li key={g.group} className="flex flex-wrap gap-x-2">
              <span className="mono text-amber">{g.source_ids.join(" + ")}</span>
              <span className="text-muted">{g.group}</span>
              <span>{g.claim ? stateWords(g.claim, rt.kind, rt.unit) : "contradicts itself: claims nothing"}</span>
            </li>
          ))}
          {result.groups.length === 0 ? <li className="text-muted">None.</li> : null}
        </ul>
      </Step>

      <Step marker="P" title={`Policy: ${POLICY[result.policy.kind].label}`}>
        <p className="text-sm text-muted">{POLICY[result.policy.kind].meaning}</p>
      </Step>

      <Step marker="G" title="GenLayer result" last>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-lg font-semibold ${result.reconciliation_status === "RESOLVED" ? "text-support" : "text-amber"}`}>
            {stateWords(result.state, rt.kind, rt.unit)}
          </span>
          <ReconciliationChip status={result.reconciliation_status} />
        </div>
        <p className="mt-1 text-sm text-muted">{result.summary}.</p>
        <p className="mt-1 text-xs text-muted">
          Observed {formatTime(result.observation_time)} ·{" "}
          {result.status === "FINALIZED" ? `final ${formatTime(result.finalized_at)}` : "not final yet"} · valid until{" "}
          {formatTime(result.valid_until)}
        </p>
      </Step>
    </ol>
  );
}

function SourceBody({ e, kind, unit }: { e: EvidenceReport; kind: ReconResult["result_type"]["kind"]; unit?: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceChip status={e.evidence_status} />
        <FreshnessChip freshness={e.freshness} />
        <span className="mono text-[10.5px] uppercase tracking-wider text-muted">{SOURCE_CLASS[e.source_class]}</span>
      </div>
      {e.availability !== "AVAILABLE" ? (
        <p className="text-sm text-muted">
          {e.availability === "MISSING" ? "The address answered that the page does not exist." : "The page could not be read."}{" "}
          Unavailable evidence is never counted as a contradiction.
        </p>
      ) : e.claim_value === "NONE" ? (
        <p className="text-sm text-muted">Readable, but it does not answer the question.</p>
      ) : (
        <>
          <p className="text-sm">
            States <span className="font-semibold">{stateWords(e.claim_value, kind, unit)}</span>
          </p>
          <blockquote className="border-l-2 border-edge pl-3 text-sm text-muted">&ldquo;{e.claim}&rdquo;</blockquote>
        </>
      )}
      {e.derived_from ? (
        <p className="text-sm">
          <span className="text-amber">Repeats {e.derived_from}.</span>{" "}
          <span className="text-muted">It counts with that source, not as another voice: &ldquo;{e.derived_quote}&rdquo;</span>
        </p>
      ) : null}
      <dl className="mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <dt>address</dt>
        <dd className="break-all"><a href={e.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-warm">{e.source_url}</a></dd>
        <dt>dated</dt>
        <dd>{e.published_at ? `${formatDay(e.published_at)} (stated on the page)` : "no date stated on the page"}</dd>
        <dt>modified</dt>
        <dd>{e.updated_at ? `${formatDay(e.updated_at)} (server header)` : "not given by the server"}</dd>
        <dt>freshness</dt>
        <dd>{FRESHNESS[e.freshness].meaning}</dd>
      </dl>
    </div>
  );
}

function Step({ marker, title, children, nested = false, last = false }: {
  marker: string; title: string; children: React.ReactNode; nested?: boolean; last?: boolean;
}) {
  return (
    <li className={`relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 ${nested ? "sm:pl-8" : ""}`}>
      <div className="flex flex-col items-center">
        <span className="mono flex h-7 w-7 items-center justify-center border border-edge bg-slate text-[11px] text-amber" aria-hidden="true">
          {marker}
        </span>
        {!last ? <span className="w-px flex-1 bg-hairline" aria-hidden="true" /> : null}
      </div>
      <div className="min-w-0 pb-5">
        <h3 className="mb-1.5 text-sm font-semibold">
          <span className="sr-only">{marker}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}
