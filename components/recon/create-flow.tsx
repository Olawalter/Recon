"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { TxTracker } from "@/components/consensus/tx-tracker";
import { useNow, useRecon, useSend } from "@/lib/genlayer/hooks";
import { createCall, reads, reconCreated, type PolicyKind, type ResultKind } from "@/lib/genlayer/recon";
import { POLICY, RESULT_KIND, describePolicy, duration, formatGen, formatTime } from "@/lib/formatting/present";
import { blankDraft, originOf, originsOf, termsFromDraft, toAtto, validateDraft, type Draft, type Problems } from "@/lib/validation/request";
import { useWallet } from "@/lib/wallet/wallet";

const STEPS = [
  { id: "question", label: "Question", fields: ["question"] },
  { id: "sources", label: "Sources", fields: ["sources"] },
  { id: "type", label: "Result type", fields: ["values", "unit", "decimals", "tolerance"] },
  { id: "policy", label: "Policy", fields: ["policy", "minGroups", "minConfirmations", "threshold"] },
  { id: "window", label: "Observation window", fields: ["window"] },
  { id: "freshness", label: "Freshness", fields: ["freshness", "validity"] },
  { id: "bond", label: "Bond", fields: ["bond"] },
  { id: "review", label: "Review", fields: [] },
] as const;

const problemsFor = (p: Problems, fields: readonly string[]) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => fields.some((f) => k === f || k.startsWith(`${f}.`))));

const toLocal = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 16);
const fromLocal = (v: string) => {
  const ms = Date.parse(`${v}:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

export function CreateFlow() {
  const now = useNow(30_000);
  const router = useRouter();
  const wallet = useWallet();
  const { client, config } = useRecon();
  const sender = useSend();
  const [draft, setDraft] = useState<Draft>(() => blankDraft(Math.floor(Date.now() / 1000)));
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const announced = useRef(step);
  useEffect(() => {
    if (announced.current === step) return;
    announced.current = step;
    title.current?.focus();
  }, [step]);

  const problems = useMemo(() => validateDraft(draft, now), [draft, now]);
  const stepProblems = (i: number) => problemsFor(problems, STEPS[i]!.fields);
  const visible = shown.has(step) ? stepProblems(step) : {};
  const ready = Object.keys(problems).length === 0;
  const firstBad = STEPS.findIndex((_, i) => i < STEPS.length - 1 && Object.keys(stepProblems(i)).length > 0);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const next = () => {
    setShown((s) => new Set(s).add(step));
    if (Object.keys(stepProblems(step)).length === 0) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const sign = async () => {
    if (!ready || !wallet.account) return;
    const who = wallet.account;
    // The counts before signing are what "created" and "sent back" are judged
    // against afterwards. Guessing them would let a refused creation read as
    // created, so without them nothing is sent.
    let known: number, knownReturned: number;
    try {
      [known, knownReturned] = await Promise.all([
        reads.byCreator(client, config, who, 0, 1).then((p) => p.total),
        reads.returnedFor(client, config, who, 0, 1).then((p) => p.total),
      ]);
    } catch {
      setBaselineError("The contract could not be read just now, so nothing was sent. Try again in a moment.");
      return;
    }
    setBaselineError(null);
    await sender.send({
      call: createCall(draft.question.replace(/\s+/g, " ").trim(), termsFromDraft(draft), toAtto(draft.bond)!),
      reconciled: reconCreated(client, config, who, known, knownReturned),
      onSettled: async (final) => {
        if (final.happened < 6) return;
        const page = await reads.byCreator(client, config, who, 0, 1).catch(() => null);
        const id = page?.items[0]?.recon_id;
        if (id) router.push(`/recon/${id}`);
      },
    });
  };

  const current = STEPS[step]!;
  const origins = originsOf(draft.sources);

  return (
    <div className="grid gap-8">
      <header className="grid gap-2 border-b border-hairline pb-6">
        <p className="label">Create Recon</p>
        <h1 className="text-2xl sm:text-3xl">Ask a question the sources disagree on</h1>
        <p className="max-w-2xl text-sm text-muted">
          These terms cannot be changed once the request is created: the question, the sources that may answer it, the form
          of the answer, the policy that reconciles them, when they are observed and the bond.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <ol className="no-scrollbar flex gap-1 overflow-x-auto lg:grid lg:content-start" aria-label="Steps">
          {STEPS.map((s, i) => {
            const on = i === step;
            const complete = i < step && Object.keys(stepProblems(i)).length === 0;
            return (
              <li key={s.id} className="shrink-0">
                <button type="button" aria-current={on ? "step" : undefined} onClick={() => setStep(i)}
                        className={`relative flex w-full items-baseline gap-2.5 px-2 py-1.5 text-left text-sm ${on ? "bg-slate text-warm" : "text-muted hover:text-warm"}`}>
                  <span className={`mono text-[10.5px] ${on ? "text-amber" : complete ? "text-support" : ""}`} aria-hidden="true">
                    {complete ? "✓" : String(i + 1).padStart(2, "0")}
                  </span>
                  {s.label}
                  {complete ? <span className="sr-only">, complete</span> : null}
                </button>
              </li>
            );
          })}
        </ol>

        <section className="pane min-w-0" aria-labelledby="step-title">
          <h2 id="step-title" ref={title} tabIndex={-1} className="pane-title focus:outline-none">
            <span className="index">{String(step + 1).padStart(2, "0")}</span>
            <span>{current.label}</span>
          </h2>
          <div className="grid gap-5 p-4 sm:p-6">
            {current.id === "question" ? (
              <Field id="question" label="The question" hint="One question, answerable from the sources. The validators read it as written."
                     error={visible.question}>
                <textarea id="question" rows={3} className="control" value={draft.question} aria-invalid={!!visible.question}
                          aria-describedby="question-hint" placeholder="Is the Northwind API operational right now?"
                          onChange={(e) => set({ question: e.target.value })} />
              </Field>
            ) : null}

            {current.id === "sources" ? (
              <div className="grid gap-4">
                <p className="text-sm text-muted">
                  Between 2 and 6 sources. They are fetched fresh at every observation by every validator. Sources on one
                  publisher count as one voice, and a source that repeats another counts with it.
                </p>
                {visible.sources ? <p role="alert" className="text-sm text-conflict">{visible.sources}</p> : null}
                <ul className="grid gap-3">
                  {draft.sources.map((s, i) => {
                    const sid = `E${i + 1}`;
                    const err = visible[`sources.${i}.url`] ?? visible[`sources.${i}.label`];
                    return (
                      <li key={i} className="grid gap-2 border border-hairline bg-graphite p-3 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_auto] sm:items-start">
                        <span className="mono pt-2 text-xs text-amber">{sid}</span>
                        <div className="grid gap-2">
                          <label className="sr-only" htmlFor={`src-${i}`}>Address of source {sid}</label>
                          <input id={`src-${i}`} className="control mono" value={s.url} placeholder="https://…"
                                 aria-invalid={!!visible[`sources.${i}.url`]} aria-describedby={err ? `src-${i}-err` : undefined}
                                 onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                          <label className="sr-only" htmlFor={`lbl-${i}`}>Label for source {sid}</label>
                          <input id={`lbl-${i}`} className="control" value={s.label} placeholder="What this source is (optional)"
                                 onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                          {s.url.trim() ? <span className="mono text-[11px] text-muted">publisher {originOf(s.url.trim())}</span> : null}
                          {err ? <span id={`src-${i}-err`} className="text-xs text-conflict">{err}</span> : null}
                        </div>
                        <div>
                          <label className="sr-only" htmlFor={`cls-${i}`}>Declared class of source {sid}</label>
                          <select id={`cls-${i}`} className="control" value={s.declared_class}
                                  onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, declared_class: e.target.value as typeof s.declared_class } : x)) })}>
                            <option value="UNKNOWN">Undeclared</option>
                            <option value="OFFICIAL">Official</option>
                            <option value="INDEPENDENT">Independent</option>
                          </select>
                        </div>
                        <button type="button" className="text-xs text-muted underline underline-offset-4 hover:text-warm sm:pt-2"
                                aria-label={`Remove source ${sid}`} disabled={draft.sources.length <= 2}
                                onClick={() => set({ sources: draft.sources.filter((_, j) => j !== i) })}>
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn" disabled={draft.sources.length >= 6}
                          onClick={() => set({ sources: [...draft.sources, { url: "", label: "", declared_class: "UNKNOWN" }] })}>
                    Add source
                  </button>
                  <span className="text-sm text-muted">
                    {origins.length} independent publisher{origins.length === 1 ? "" : "s"} so far
                  </span>
                </div>
                <p className="text-xs text-muted">
                  A declared class is your claim about a source, shown as yours. Validators never rely on it; only the
                  authority confirmation policy uses &ldquo;official&rdquo;.
                </p>
              </div>
            ) : null}

            {current.id === "type" ? (
              <div className="grid gap-4">
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold">What form must the answer take?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["CATEGORICAL", "BOOLEAN", "NUMERIC", "TEMPORAL"] as ResultKind[]).map((k) => (
                      <label key={k} className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm ${draft.kind === k ? "border-amber" : "border-hairline"}`}>
                        <input type="radio" name="kind" value={k} checked={draft.kind === k} onChange={() => set({ kind: k })} />
                        {RESULT_KIND[k]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {draft.kind === "CATEGORICAL" ? (
                  <Field id="values" label="The possible values" hint="Separate with commas: capitals, digits or underscores. UNRESOLVED is always possible and is never listed."
                         error={visible.values}>
                    <input id="values" className="control mono" value={draft.values.join(", ")} aria-invalid={!!visible.values}
                           aria-describedby="values-hint" onChange={(e) => set({ values: e.target.value.split(",").map((v) => v.trim().toUpperCase()) })} />
                  </Field>
                ) : null}
                {draft.kind === "NUMERIC" ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field id="unit" label="Unit" hint="As the sources write it." error={visible.unit}>
                      <input id="unit" className="control" value={draft.unit} aria-invalid={!!visible.unit} aria-describedby="unit-hint"
                             onChange={(e) => set({ unit: e.target.value })} />
                    </Field>
                    <Field id="decimals" label="Decimal places" hint="0 to 6." error={visible.decimals}>
                      <input id="decimals" type="number" min={0} max={6} className="control mono" value={draft.decimals}
                             aria-invalid={!!visible.decimals} aria-describedby="decimals-hint"
                             onChange={(e) => set({ decimals: Number(e.target.value) })} />
                    </Field>
                    <Field id="tolerance" label="Agreement tolerance, per cent" hint="Two figures within this share agree." error={visible.tolerance}>
                      <input id="tolerance" className="control mono" value={draft.tolerancePct} inputMode="decimal"
                             aria-invalid={!!visible.tolerance} aria-describedby="tolerance-hint"
                             onChange={(e) => set({ tolerancePct: e.target.value })} />
                    </Field>
                  </div>
                ) : null}
                {draft.kind === "BOOLEAN" ? <p className="text-sm text-muted">Each source is read as stating true, false, or nothing.</p> : null}
                {draft.kind === "TEMPORAL" ? (
                  <p className="text-sm text-muted">Each source is read for a calendar date it states; the date must be written in the passage quoted.</p>
                ) : null}
              </div>
            ) : null}

            {current.id === "policy" ? (
              <div className="grid gap-4">
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold">How are disagreeing sources reconciled?</legend>
                  {(["MAJORITY", "THRESHOLD", "AUTHORITY_CONFIRMATION", "STRICT"] as PolicyKind[]).map((k) => (
                    <label key={k} className={`grid cursor-pointer gap-0.5 border px-3 py-2 ${draft.policy === k ? "border-amber" : "border-hairline"}`}>
                      <span className="flex items-center gap-2 text-sm">
                        <input type="radio" name="policy" value={k} checked={draft.policy === k} onChange={() => set({ policy: k })} />
                        {POLICY[k].label}
                      </span>
                      <span className="pl-6 text-xs text-muted">{POLICY[k].meaning}</span>
                    </label>
                  ))}
                </fieldset>
                {visible.policy ? <p role="alert" className="text-sm text-conflict">{visible.policy}</p> : null}
                {draft.policy === "AUTHORITY_CONFIRMATION" ? (
                  <Field id="confirmations" label="Independent confirmations needed" hint="Publishers other than the official one." error={visible.minConfirmations}>
                    <input id="confirmations" type="number" min={1} max={5} className="control mono" value={draft.minConfirmations}
                           aria-invalid={!!visible.minConfirmations} aria-describedby="confirmations-hint"
                           onChange={(e) => set({ minConfirmations: Number(e.target.value) })} />
                  </Field>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="groups" label="Independent publishers needed" hint={`The sources come from ${origins.length}.`} error={visible.minGroups}>
                      <input id="groups" type="number" min={2} max={6} className="control mono" value={draft.minGroups}
                             aria-invalid={!!visible.minGroups} aria-describedby="groups-hint"
                             onChange={(e) => set({ minGroups: Number(e.target.value) })} />
                    </Field>
                    {draft.policy === "THRESHOLD" ? (
                      <Field id="threshold" label="Share that must agree, per cent" hint="Above 50, at most 100." error={visible.threshold}>
                        <input id="threshold" className="control mono" value={draft.thresholdPct} inputMode="decimal"
                               aria-invalid={!!visible.threshold} aria-describedby="threshold-hint"
                               onChange={(e) => set({ thresholdPct: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={draft.staleContributes}
                         onChange={(e) => set({ staleContributes: e.target.checked })} />
                  <span>
                    Let stale evidence count
                    <span className="block text-xs text-muted">Off by default: evidence older than the freshness requirement, or undated, is kept out.</span>
                  </span>
                </label>
              </div>
            ) : null}

            {current.id === "window" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="start" label="Observation opens (UTC)" hint="Now, or later." error={visible.window}>
                  <input id="start" type="datetime-local" className="control mono" value={toLocal(draft.windowStart)}
                         aria-invalid={!!visible.window} aria-describedby="start-hint" onChange={(e) => set({ windowStart: fromLocal(e.target.value) })} />
                </Field>
                <Field id="end" label="Observation closes (UTC)" hint={`Open for ${duration(Math.max(0, draft.windowEnd - draft.windowStart))}. The bond is refundable after this.`}>
                  <input id="end" type="datetime-local" className="control mono" value={toLocal(draft.windowEnd)}
                         aria-describedby="end-hint" onChange={(e) => set({ windowEnd: fromLocal(e.target.value) })} />
                </Field>
              </div>
            ) : null}

            {current.id === "freshness" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="freshness" label="Freshness requirement, days" hint="0: age is not a condition. Otherwise, older or undated evidence is stale." error={visible.freshness}>
                  <input id="freshness" className="control mono" value={draft.freshnessDays} inputMode="decimal"
                         aria-invalid={!!visible.freshness} aria-describedby="freshness-hint" onChange={(e) => set({ freshnessDays: e.target.value })} />
                </Field>
                <Field id="validity" label="A result stays current for, hours" hint="After this it is not shown as current, and can be recorded as expired." error={visible.validity}>
                  <input id="validity" className="control mono" value={draft.validityHours} inputMode="decimal"
                         aria-invalid={!!visible.validity} aria-describedby="validity-hint" onChange={(e) => set({ validityHours: e.target.value })} />
                </Field>
              </div>
            ) : null}

            {current.id === "bond" ? (
              <div className="grid gap-4">
                <Field id="bond" label="Bond, in GEN" hint="Sent as the transaction's value; at least 0.001 GEN." error={visible.bond}>
                  <input id="bond" className="control mono" value={draft.bond} inputMode="decimal" aria-invalid={!!visible.bond}
                         aria-describedby="bond-hint" onChange={(e) => set({ bond: e.target.value })} />
                </Field>
                <p className="border border-hairline bg-graphite p-4 text-sm text-muted">
                  The bond is an economic commitment attached to the request, to discourage meaningless requests. It is not a
                  stake on the answer and cannot change it. The contract holds it until the observation window closes, then
                  anyone may return it, in full, to you.
                </p>
              </div>
            ) : null}

            {current.id === "review" ? (
              <Review draft={draft} firstBad={firstBad} problems={problems} goTo={(i) => { setShown((s) => new Set(s).add(i)); setStep(i); }} />
            ) : null}

            {current.id === "review" ? (
              <div className="grid gap-3 border-t border-hairline pt-5">
                {!wallet.account ? <p className="text-sm text-amber">Connect a wallet to create this request.</p> : null}
                <button type="button" className="btn btn-primary w-fit" disabled={!ready || !wallet.account || sender.busy} onClick={sign}>
                  {sender.busy ? "Sending…" : `Create Recon${ready ? ` · bond ${formatGen(toAtto(draft.bond) ?? "0")}` : ""}`}
                </button>
                {baselineError ? <p role="alert" className="text-sm text-conflict">{baselineError}</p> : null}
                <TxTracker state={sender.state} done="The request is recorded in the contract. Opening it…" />
              </div>
            ) : null}

            <div className="flex justify-between gap-3 border-t border-hairline pt-5">
              <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
              {step < STEPS.length - 1 ? <button type="button" className="btn" onClick={next}>{STEPS[step + 1]!.label}</button> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children}
      <span id={`${id}-hint`} className={`text-xs ${error ? "text-conflict" : "text-muted"}`}>{error ?? hint}</span>
    </div>
  );
}

function Review({ draft, firstBad, problems, goTo }: { draft: Draft; firstBad: number; problems: Problems; goTo: (i: number) => void }) {
  const terms = termsFromDraft(draft);
  const origins = originsOf(draft.sources);
  return (
    <div className="grid gap-5">
      {firstBad >= 0 ? (
        <div role="alert" className="border border-conflict/60 px-4 py-3 text-sm">
          <p className="text-conflict">These terms are not complete yet.</p>
          <p className="mt-1 text-muted">
            {Object.values(problemsFor(problems, STEPS[firstBad]!.fields))[0]}{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => goTo(firstBad)}>
              Go to {STEPS[firstBad]!.label.toLowerCase()}
            </button>
          </p>
        </div>
      ) : null}
      <p className="label">These terms cannot be changed after the request is created</p>
      <dl className="grid gap-4 text-sm">
        <Row k="Question">{draft.question || "Not written yet"}</Row>
        <Row k="Sources">
          <ul className="grid gap-1">
            {terms.sources.map((s, i) => (
              <li key={i} className="grid">
                <span><span className="mono mr-2 text-amber">E{i + 1}</span><span className="mono break-all text-xs">{s.url || "no address"}</span></span>
                <span className="text-xs text-muted">
                  {s.url ? `publisher ${originOf(s.url)}` : ""}{s.declared_class !== "UNKNOWN" ? ` · declared ${s.declared_class.toLowerCase()}` : ""}
                  {s.label ? ` · ${s.label}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{origins.length} independent publisher{origins.length === 1 ? "" : "s"}.</p>
        </Row>
        <Row k="Answer form">
          {RESULT_KIND[terms.result_type.kind]}
          {terms.result_type.values ? `: ${terms.result_type.values.join(", ")}` : ""}
          {terms.result_type.kind === "NUMERIC" ? ` in ${terms.result_type.unit}, ${terms.result_type.decimals} decimal places, agreeing within ${(terms.result_type.tolerance_bps ?? 0) / 100} per cent` : ""}
        </Row>
        <Row k="Policy">{POLICY[terms.policy.kind].label}. {describePolicy({ policy: terms.policy })}</Row>
        <Row k="Observation window">{formatTime(terms.observation_window_start)} to {formatTime(terms.observation_window_end)}</Row>
        <Row k="Freshness">
          {terms.freshness_requirement ? `Evidence no older than ${duration(terms.freshness_requirement)}` : "Age is not a condition"}; a result stays
          current for {duration(terms.validity_seconds)}.
        </Row>
        <Row k="Bond">{toAtto(draft.bond) ? formatGen(toAtto(draft.bond)!) : "Not valid"}, refunded in full to you after the window closes.</Row>
      </dl>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-hairline pb-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="label pt-0.5">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
