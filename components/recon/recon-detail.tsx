"use client";

import { useEffect } from "react";

import { BondPanel } from "@/components/bond/bond-panel";
import { ConflictGraph } from "@/components/conflict-graph/conflict-graph";
import { LifecyclePanel } from "@/components/consensus/lifecycle-panel";
import { EvidenceMap } from "@/components/evidence/evidence-map";
import { ActsPanel } from "@/components/recon/acts-panel";
import { EvidenceChip, FreshnessChip, ReconciliationChip, StatusChip } from "@/components/recon/chips";
import { StateHistory } from "@/components/recon/state-history";
import { Pane } from "@/components/ui/pane";
import { configResult } from "@/lib/genlayer/config";
import { pastValidity } from "@/lib/genlayer/acts";
import { DETAIL_POLL_MS, useChainTxs, useNow, useReconView } from "@/lib/genlayer/hooks";
import { isMissing, observationFor, transactionsFor } from "@/lib/genlayer/recon";
import { POLICY, RESULT_KIND, SOURCE_CLASS, describePolicy, duration, formatTime, reconLabel, resultLabel,
  stateWords } from "@/lib/formatting/present";
import { hostLabel } from "@/components/conflict-graph/conflict-graph";

/**
 * The primary interface. Every value here is a field of the contract's own
 * state (get_recon, get_results, get_history) or of a transaction's own record
 * on GenLayer; the page computes nothing that the contract decides.
 */
export function ReconDetail({ id }: { id: string }) {
  const view = useReconView(id, DETAIL_POLL_MS);
  const chain = useChainTxs(30_000);
  const now = useNow(15_000);
  // Re-read the transaction listing the moment the request changes, rather
  // than leaving the lifecycle and transaction panes a poll behind the state.
  const changeKey = view.data ? `${view.data.recon.result_count}|${view.data.recon.status}|${view.data.recon.bond_status}` : "";
  const reloadChain = chain.reload;
  useEffect(() => {
    if (changeKey) reloadChain();
  }, [changeKey, reloadChain]);

  if (view.error && isMissing(view.error)) {
    return <Notice title={`${reconLabel(id)} does not exist`}>No request with this number has been created on this contract.</Notice>;
  }
  if (view.error && !view.data) {
    return (
      <Notice title="The contract could not be read">
        {view.error.message} <button type="button" className="underline" onClick={view.reload}>Try again</button>
      </Notice>
    );
  }
  if (!view.data) return <DetailSkeleton />;

  const { recon, results, history } = view.data;
  const latest = results.at(-1);
  const rt = recon.result_type;
  const txs = chain.data ? transactionsFor(chain.data, recon.recon_id) : undefined;
  const lookup = chain.error ? "failed" : !chain.data ? "loading" : "found";
  const observeTx = latest && txs ? observationFor(txs.observations, latest.proposed_at) : undefined;
  const explorer = configResult.ok ? configResult.config.explorer : "";
  const expiredUnrecorded = pastValidity(recon, latest, now);

  return (
    <div className="grid gap-6">
      {/* header */}
      <header className="grid gap-3 border-b border-hairline pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono text-sm text-amber">{reconLabel(recon.recon_id)}</span>
          <StatusChip status={recon.status} />
          {latest ? <ReconciliationChip status={latest.reconciliation_status} /> : null}
        </div>
        <h1 className="max-w-4xl text-2xl sm:text-3xl">{recon.question}</h1>
        <CurrentState recon={recon} latestState={latest?.state} expiredUnrecorded={expiredUnrecorded}
                      pending={recon.status === "PROPOSED"} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          {latest ? (
            <>
              <Pane index="01" title="Evidence map" aside={`${resultLabel(latest.result_id)} · ${latest.status.toLowerCase()}`}>
                <EvidenceMap result={latest} question={recon.question} />
              </Pane>
              <Pane index="02" title="Conflict graph">
                <ConflictGraph result={latest} question={recon.question} />
              </Pane>
            </>
          ) : (
            <Pane index="01" title="Evidence">
              <p className="text-sm text-muted">
                No observation yet. When GenLayer observes, every validator fetches each source, the evidence map and conflict
                graph are drawn from what they agreed, and the result appears here.
              </p>
            </Pane>
          )}

          <Pane index="03" title="Reconciliation policy">
            <div className="grid gap-2 text-sm">
              <p><span className="font-semibold">{POLICY[recon.policy.kind].label}.</span> {describePolicy(recon)}</p>
              <p className="text-muted">
                Answer form: {RESULT_KIND[rt.kind].toLowerCase()}
                {rt.kind === "CATEGORICAL" ? ` (${(rt.values ?? []).map((v) => stateWords(v, rt.kind)).join(", ")})` : ""}
                {rt.kind === "NUMERIC" ? ` in ${rt.unit}, agreeing within ${(rt.tolerance_bps ?? 0) / 100} per cent` : ""}.
                Freshness: {recon.freshness_requirement ? `no older than ${duration(recon.freshness_requirement)}` : "age is not a condition"}.
                A result stays current for {duration(recon.validity_seconds)}.
              </p>
              <p className="text-xs text-muted">
                Sources are counted by publisher. A class marked declared is the creator&apos;s claim about a source, shown as
                such; the panel never relies on it, and only authority confirmation uses it.
              </p>
            </div>
          </Pane>

          <Pane index="04" title="Source status">
            <SourceTable recon={recon} latest={latest} />
          </Pane>

          <Pane index="05" title="State history" aside={`${history.length} finalized transition${history.length === 1 ? "" : "s"}`}>
            <StateHistory history={history} kind={rt.kind} unit={rt.unit} />
            {results.length > 1 ? (
              <p className="mt-3 text-xs text-muted">
                Every observation is kept as its own record: {results.map((r) => resultLabel(r.result_id)).join(", ")}.
              </p>
            ) : null}
          </Pane>
        </div>

        <aside className="grid content-start gap-6">
          <Pane index="06" title="What can be done now">
            <ActsPanel recon={recon} latest={latest} onChanged={view.reload} />
          </Pane>
          <Pane index="07" title="GenLayer lifecycle">
            <LifecyclePanel recon={recon} result={latest} tx={observeTx} txLookup={lookup} />
          </Pane>
          <Pane index="08" title="Bond">
            <BondPanel recon={recon} refundTx={txs?.refund} txLookup={lookup} now={now} />
          </Pane>
          <Pane index="09" title="Transaction and contract">
            <dl className="mono grid gap-2 text-[11px] text-muted">
              <div>
                <dt className="label">Observation window</dt>
                <dd className="mt-0.5 text-warm">{formatTime(recon.observation_window_start)} to {formatTime(recon.observation_window_end)}</dd>
              </div>
              {txs && txs.all.length ? (
                <div>
                  <dt className="label">Transactions on this request</dt>
                  <dd className="mt-1 grid gap-0.5">
                    {txs.all.map((t) => (
                      <a key={t.hash} href={`${explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer"
                         className="underline underline-offset-2 hover:text-warm">
                        {t.method.replace(/_/g, " ")} · {t.status.toLowerCase()}
                        {t.execution && t.execution !== "SUCCESS" ? " · refused" : ""}
                      </a>
                    ))}
                  </dd>
                </div>
              ) : null}
              {configResult.ok ? (
                <div>
                  <dt className="label">Contract</dt>
                  <dd className="mt-0.5 break-all">
                    <a href={`${explorer}/address/${configResult.config.contractAddress}`} target="_blank" rel="noreferrer"
                       className="underline underline-offset-2 hover:text-warm">{configResult.config.contractAddress}</a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="label">Rules</dt>
                <dd className="mt-0.5">{recon.policy_rules}</dd>
              </div>
            </dl>
          </Pane>
        </aside>
      </div>
    </div>
  );
}

function CurrentState({ recon, latestState, expiredUnrecorded, pending }: {
  recon: ReconView["recon"]; latestState?: string; expiredUnrecorded: boolean; pending: boolean;
}) {
  const rt = recon.result_type;
  const state = recon.current_state;
  if (!state) {
    return (
      <p className="text-sm text-muted">
        {pending && latestState
          ? `A result (${stateWords(latestState, rt.kind, rt.unit)}) is pending the contract's finality delay; nothing is current until it is final.`
          : "No state has been established yet."}
      </p>
    );
  }
  const tone = state === "UNRESOLVED" || state === "EXPIRED" || expiredUnrecorded ? "text-amber" : "text-support";
  return (
    <div className="grid gap-1">
      <p className="label">{state === "EXPIRED" ? "No longer current" : expiredUnrecorded ? "Past its validity" : "Final state"}</p>
      <p className={`text-3xl font-semibold ${tone}`}>
        {state === "EXPIRED" ? "Expired" : stateWords(state, rt.kind, rt.unit)}
      </p>
      {expiredUnrecorded ? (
        <p className="text-sm text-muted">
          This result&apos;s validity has passed, so it is not shown as current. Anyone may record the expiry or, while the
          window is open, observe again.
        </p>
      ) : null}
      {pending ? <p className="text-sm text-amber">A newer result is pending finality.</p> : null}
    </div>
  );
}

type ReconView = { recon: import("@/lib/genlayer/recon").Recon };

function SourceTable({ recon, latest }: { recon: ReconView["recon"]; latest?: import("@/lib/genlayer/recon").ReconResult }) {
  const byId = new Map((latest?.evidence ?? []).map((e) => [e.source_id, e]));
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">Each source, as the latest result recorded it</caption>
        <thead>
          <tr className="label border-b border-hairline">
            <th scope="col" className="px-1 py-2 font-normal">Source</th>
            <th scope="col" className="px-1 py-2 font-normal">Class</th>
            <th scope="col" className="px-1 py-2 font-normal">Freshness</th>
            <th scope="col" className="px-1 py-2 font-normal">Counted as</th>
          </tr>
        </thead>
        <tbody>
          {recon.sources.map((s) => {
            const e = byId.get(s.source_id);
            return (
              <tr key={s.source_id} className="border-b border-hairline last:border-0">
                <th scope="row" className="px-1 py-2 font-normal">
                  <span className="mono mr-2 text-amber">{s.source_id}</span>
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-amber">
                    {s.label || hostLabel(s.url)}
                  </a>
                  <span className="mono block text-[10.5px] text-muted">publisher {s.origin}</span>
                </th>
                <td className="px-1 py-2 text-xs text-muted">{SOURCE_CLASS[e?.source_class ?? s.declared_class]}</td>
                <td className="px-1 py-2">{e ? <FreshnessChip freshness={e.freshness} /> : <span className="text-xs text-muted">Not observed</span>}</td>
                <td className="px-1 py-2">{e ? <EvidenceChip status={e.evidence_status} /> : <span className="text-xs text-muted">Not observed</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pane max-w-2xl" role="alert">
      <div className="pane-title"><span className="index">!</span>{title}</div>
      <p className="p-5 text-sm text-muted">{children}</p>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading the request">
      <div className="h-6 w-40 animate-pulse bg-slate" />
      <div className="h-9 w-3/4 animate-pulse bg-slate" />
      <div className="h-64 animate-pulse bg-charcoal" />
    </div>
  );
}
