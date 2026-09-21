"use client";

import Link from "next/link";

import { ConflictList } from "@/components/conflict-graph/conflict-graph";
import { ReconciliationChip } from "@/components/recon/chips";
import { useRead } from "@/lib/genlayer/hooks";
import { reads } from "@/lib/genlayer/recon";
import { reconLabel, stateWords } from "@/lib/formatting/present";

/** The pipeline, as a labelled schematic. It illustrates the process; the
 * panel beside it shows a real reconciliation read from the contract. */
function Pipeline() {
  const steps = [
    { k: "Sources", v: "Pages and APIs named in the request" },
    { k: "Conflict", v: "What each states; who agrees; who repeats whom" },
    { k: "GenLayer", v: "Every validator reads for itself and must agree" },
    { k: "Final state", v: "Recorded on chain, or UNRESOLVED" },
  ];
  return (
    <ol className="grid gap-0" aria-label="How a reconciliation works">
      {steps.map((s, i) => (
        <li key={s.k} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <span className={`mono flex h-8 w-8 items-center justify-center border text-xs ${i === 3 ? "border-amber bg-amber text-graphite"
              : "border-edge bg-slate text-amber"}`} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            {i < steps.length - 1 ? <span className="h-6 w-px bg-edge" aria-hidden="true" /> : null}
          </div>
          <div className="pb-2">
            <p className="text-sm font-semibold">{s.k}</p>
            <p className="text-xs text-muted">{s.v}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function LatestReal() {
  const q = useRead("landing-latest", async (c, cfg) => {
    const page = await reads.transitions(c, cfg, 0, 20);
    const t = page.items.find((x) => x.kind === "OBSERVED");
    if (!t) return null;
    const [recon, result] = await Promise.all([reads.recon(c, cfg, t.recon_id), reads.result(c, cfg, t.result_id)]);
    return { recon, result };
  });
  if (q.loading) return <div className="h-40 animate-pulse bg-slate" aria-busy="true" aria-label="Loading a real reconciliation" />;
  if (!q.data) {
    return <p className="text-sm text-muted">No reconciliation has been finalized on this contract yet.</p>;
  }
  const { recon, result } = q.data;
  const rt = result.result_type;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/recon/${recon.recon_id}`} className="mono text-xs text-amber hover:underline">{reconLabel(recon.recon_id)}</Link>
        <ReconciliationChip status={result.reconciliation_status} />
      </div>
      <p className="text-sm">{recon.question}</p>
      <p className={`text-xl font-semibold ${result.reconciliation_status === "RESOLVED" ? "text-support" : "text-amber"}`}>
        {stateWords(result.state, rt.kind, rt.unit)}
      </p>
      <ConflictList result={result} />
      <Link href={`/recon/${recon.recon_id}`} className="w-fit text-sm text-muted underline underline-offset-4 hover:text-warm">
        Open the full evidence
      </Link>
    </div>
  );
}

export function Landing() {
  return (
    <div className="grid gap-12">
      <section className="grid gap-10 border-b border-hairline pb-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-6">
          <p className="label">Decentralized reconciliation of conflicting information</p>
          <h1 className="text-4xl leading-[1.05] sm:text-5xl">When information conflicts, consensus establishes the state.</h1>
          <p className="max-w-xl text-base text-muted">
            RECON uses GenLayer to independently reconcile conflicting external evidence and commit the resulting state
            on-chain.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/create" className="btn btn-primary">Create Recon</Link>
            <Link href="/dashboard" className="btn">Explore Reconciliations</Link>
          </div>
        </div>
        <div className="pane">
          <h2 className="pane-title"><span className="index" aria-hidden="true">◆</span>Sources → Conflict → GenLayer → Final state</h2>
          <div className="p-5"><Pipeline /></div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-2">
          <h2 className="label">01 · The problem</h2>
          <p className="text-sm text-muted">
            Status pages, registries, news and APIs disagree, go stale and copy one another. Whoever decides which one to
            believe decides the answer, and today that is usually one server nobody can check.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <h2 className="label">02 · What RECON does</h2>
          <p className="text-sm text-muted">
            A request fixes the question, the sources, the form of the answer and a policy. Each validator fetches every
            source itself, reports what each one states with the exact passage, and the contract applies the policy in
            code. Too little agreement is UNRESOLVED, never a guess.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <h2 className="label">03 · Why GenLayer</h2>
          <p className="text-sm text-muted">
            Reading a page and saying what it claims is judgement, and a single server&apos;s judgement is exactly what a
            conflict puts in doubt. On GenLayer that judgement is repeated independently and recorded only when the
            validators agree on every source&apos;s claim, date and independence.
          </p>
        </div>
      </section>

      <section className="pane">
        <h2 className="pane-title"><span className="index" aria-hidden="true">◆</span>Latest finalized reconciliation, read from the contract</h2>
        <div className="p-5"><LatestReal /></div>
      </section>
    </div>
  );
}
