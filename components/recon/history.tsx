"use client";

import Link from "next/link";
import { useState } from "react";

import { Pane } from "@/components/ui/pane";
import { LIST_POLL_MS, useRead } from "@/lib/genlayer/hooks";
import { reads, type Transition } from "@/lib/genlayer/recon";
import { formatTime, reconLabel, resultLabel, stateWords } from "@/lib/formatting/present";

const PAGE = 25;

/**
 * Every finalized state transition, across every request, newest first. The
 * contract only ever appends to this list: a new observation adds a record and
 * never rewrites an earlier one, and an expiry is its own record.
 */
export function History() {
  const [pages, setPages] = useState(1);
  const q = useRead(`history:${pages}`, (c, cfg) => reads.transitions(c, cfg, 0, PAGE * pages), { pollMs: LIST_POLL_MS });
  const items = q.data?.items ?? [];
  const byRecon = new Map<string, Transition[]>();
  for (const t of items) byRecon.set(t.recon_id, [...(byRecon.get(t.recon_id) ?? []), t]);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2 border-b border-hairline pb-6">
        <p className="label">History</p>
        <h1 className="text-2xl sm:text-3xl">Finalized state transitions</h1>
        <p className="max-w-2xl text-sm text-muted">
          Each line is a record the contract appended when a result became final or a state expired. Nothing here is ever
          edited: a later observation is a new line beside the earlier one.
        </p>
      </header>

      {q.error && !q.data ? (
        <p role="alert" className="text-sm text-conflict">
          The contract could not be read: {q.error.message}{" "}
          <button type="button" className="underline" onClick={q.reload}>Try again</button>
        </p>
      ) : null}

      <Pane index="01" title="All transitions" aside={q.data ? `${q.data.total} recorded` : undefined}>
        {q.loading && !q.data ? (
          <div className="h-24 animate-pulse bg-slate" aria-busy="true" aria-label="Loading" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No state has been finalized yet.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Finalized state transitions, newest first</caption>
              <thead>
                <tr className="label border-b border-hairline">
                  <th scope="col" className="px-1 py-2 font-normal">Record</th>
                  <th scope="col" className="px-1 py-2 font-normal">From</th>
                  <th scope="col" className="px-1 py-2 font-normal">To</th>
                  <th scope="col" className="px-1 py-2 font-normal">Final</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t, i) => (
                  <tr key={`${t.result_id}-${t.kind}-${i}`} className="border-b border-hairline last:border-0">
                    <th scope="row" className="px-1 py-2 font-normal">
                      <Link href={`/recon/${t.recon_id}`} className="mono text-xs text-amber hover:underline">
                        {t.kind === "EXPIRED" ? `${reconLabel(t.recon_id)} expiry` : resultLabel(t.result_id)}
                      </Link>
                    </th>
                    <td className="px-1 py-2 text-muted">{t.previous_state ? words(t.previous_state) : "No state"}</td>
                    <td className="px-1 py-2 font-semibold">{t.new_state === "EXPIRED" ? "Expired" : words(t.new_state)}</td>
                    <td className="mono px-1 py-2 text-[11px] text-muted">{formatTime(t.finalized_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && q.data.total > items.length ? (
          <button type="button" className="btn mt-4" onClick={() => setPages((p) => p + 1)}>Show older transitions</button>
        ) : null}
      </Pane>

      {byRecon.size ? (
        <Pane index="02" title="By request">
          <ul className="grid gap-3">
            {[...byRecon.entries()].map(([rid, ts]) => (
              <li key={rid} className="text-sm">
                <Link href={`/recon/${rid}`} className="mono text-xs text-amber hover:underline">{reconLabel(rid)}</Link>
                <p className="mt-0.5">
                  {[...ts].reverse().map((t, i) => (
                    <span key={`${t.result_id}-${i}`}>
                      {i === 0 ? <span className="text-muted">{t.previous_state ? words(t.previous_state) : "No state"}</span> : null}
                      <span className="mx-1.5 text-muted" aria-hidden="true">→</span>
                      <span className="sr-only"> then </span>
                      {t.new_state === "EXPIRED" ? "Expired" : words(t.new_state)}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Pane>
      ) : null}
    </div>
  );
}

function words(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? stateWords(s, "TEMPORAL") : stateWords(s);
}
