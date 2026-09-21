"use client";

import Link from "next/link";

import { BondChip, StatusChip } from "@/components/recon/chips";
import { Pane } from "@/components/ui/pane";
import { useNow, useRecons, useTransitions } from "@/lib/genlayer/hooks";
import type { Recon } from "@/lib/genlayer/recon";
import { formatTime, reconLabel, resultLabel, stateWords } from "@/lib/formatting/present";

/**
 * The dashboard groups requests by what the contract records about them.
 * "Expired" means the contract recorded the expiry; a request whose result
 * has only passed its validity on this device's clock is shown as awaiting
 * that record, never as current.
 */

type Bucket = "active" | "finalized" | "unresolved" | "expired";

export function bucketOf(r: Recon): Bucket {
  if (r.current_state === "EXPIRED") return "expired";
  if (r.status === "SUBMITTED" || r.status === "PROPOSED") return "active";
  if (r.current_state === "UNRESOLVED" || r.status === "FAILED") return "unresolved";
  if (r.status === "CANCELLED") return "unresolved";
  return "finalized";
}

const SECTIONS: { key: Bucket; title: string; empty: string }[] = [
  { key: "active", title: "Active reconciliations", empty: "No request is awaiting an observation or a pending result." },
  { key: "finalized", title: "Finalized", empty: "No request has a resolved, final state." },
  { key: "unresolved", title: "Unresolved", empty: "No request ended unresolved." },
  { key: "expired", title: "Expired", empty: "No result has been recorded as expired." },
];

export function Dashboard() {
  const recons = useRecons(50);
  const transitions = useTransitions(12);
  const now = useNow(30_000);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
        <div className="grid gap-2">
          <p className="label">Dashboard</p>
          <h1 className="text-2xl sm:text-3xl">Reconciliations</h1>
          <p className="max-w-2xl text-sm text-muted">
            Every request this contract holds, grouped by what the contract records about it. Newest first.
          </p>
        </div>
        <Link href="/create" className="btn btn-primary">Create Recon</Link>
      </header>

      {recons.error && !recons.data ? (
        <p role="alert" className="text-sm text-conflict">
          The contract could not be read: {recons.error.message}{" "}
          <button type="button" className="underline" onClick={recons.reload}>Try again</button>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-6">
          {SECTIONS.map((s, i) => {
            const items = (recons.data?.items ?? []).filter((r) => bucketOf(r) === s.key);
            return (
              <Pane key={s.key} index={String(i + 1).padStart(2, "0")} title={s.title}
                    aside={recons.data ? `${items.length}` : undefined}>
                {recons.loading && !recons.data ? (
                  <div className="h-16 animate-pulse bg-slate" aria-busy="true" aria-label="Loading" />
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted">{s.empty}</p>
                ) : (
                  <ul className="grid gap-2">{items.map((r) => <ReconRow key={r.recon_id} r={r} now={now} />)}</ul>
                )}
              </Pane>
            );
          })}
        </div>

        <aside>
          <Pane index="05" title="Recent state transitions">
            {transitions.data && transitions.data.items.length ? (
              <ol className="grid gap-3">
                {transitions.data.items.map((t, i) => (
                  <li key={`${t.result_id}-${t.kind}-${i}`} className="grid gap-0.5 text-sm">
                    <Link href={`/recon/${t.recon_id}`} className="mono w-fit text-xs text-amber underline-offset-4 hover:underline">
                      {t.kind === "EXPIRED" ? reconLabel(t.recon_id) : resultLabel(t.result_id)}
                    </Link>
                    <span>
                      <span className="text-muted">{t.previous_state ? humanState(t.previous_state) : "No state"} → </span>
                      {t.new_state === "EXPIRED" ? "Expired" : humanState(t.new_state)}
                    </span>
                    <span className="mono text-[11px] text-muted">{formatTime(t.finalized_at)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">{transitions.loading ? "Loading…" : "No state has been finalized yet."}</p>
            )}
          </Pane>
        </aside>
      </div>
    </div>
  );
}

function humanState(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? stateWords(s, "TEMPORAL") : stateWords(s);
}

function ReconRow({ r, now }: { r: Recon; now: number }) {
  const rt = r.result_type;
  return (
    <li>
      <Link href={`/recon/${r.recon_id}`}
            className="grid gap-2 border border-hairline bg-graphite p-3 hover:border-edge-strong sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="mono text-xs text-amber">{reconLabel(r.recon_id)}</p>
          <p className="mt-0.5 text-sm">{r.question}</p>
          <p className="mono mt-1 text-[11px] text-muted">
            created {formatTime(r.created_at)}
            {r.status === "FINALIZED" || r.status === "CLOSED" ? ` · last final ${formatTime(r.updated_at)}` : ""}
            {now > r.observation_window_end ? " · window closed" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-1.5 sm:flex-col sm:items-end">
          <span className={`text-sm font-semibold ${r.current_state === "UNRESOLVED" || r.current_state === "EXPIRED" ? "text-amber"
            : r.current_state ? "text-support" : "text-muted"}`}>
            {r.current_state === "EXPIRED" ? "Expired" : r.current_state ? stateWords(r.current_state, rt.kind, rt.unit) : "No state yet"}
          </span>
          <StatusChip status={r.status} />
          <BondChip status={r.bond_status} />
        </div>
      </Link>
    </li>
  );
}
