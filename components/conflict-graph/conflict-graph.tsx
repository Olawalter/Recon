import type { ReconResult, ResultType } from "@/lib/genlayer/recon";
import { EVIDENCE, POLICY, RECONCILIATION, stateWords } from "@/lib/formatting/present";

/**
 * The Conflict Graph: which sources state what, which agree, which conflict,
 * which were not counted and why, and what the policy made of it. Every node
 * and edge comes from the recorded result; nothing is drawn that the contract
 * did not record. Wide screens get the graph; narrow screens get the same
 * relationships as a grouped list, which stays readable at any width.
 */

type Props = { result: ReconResult; question: string };

const NONE_KEY = "__none__";

function valueNodes(result: ReconResult) {
  const values: string[] = [];
  for (const e of result.evidence) {
    const counted = e.evidence_status === "SUPPORTING" || e.evidence_status === "CONFLICTING" || e.evidence_status === "UNCONTESTED";
    const key = counted ? e.claim_value : NONE_KEY;
    if (!values.includes(key)) values.push(key);
  }
  return values.sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : 0));
}

function edgeTone(status: string) {
  if (status === "SUPPORTING") return { stroke: "var(--color-support)", dash: "" };
  if (status === "CONFLICTING") return { stroke: "var(--color-conflict)", dash: "" };
  if (status === "UNCONTESTED") return { stroke: "var(--color-warm)", dash: "" };
  return { stroke: "var(--color-edge-strong)", dash: "4 4" };
}

export function ConflictGraph({ result, question }: Props) {
  const rt: ResultType = result.result_type;
  const values = valueNodes(result);
  const rows = Math.max(result.evidence.length, values.length);
  const rowH = 68;
  const height = rows * rowH + 60;
  const srcY = (i: number) => 40 + i * rowH + (rows - result.evidence.length) * rowH / 2;
  const valY = (i: number) => 40 + i * rowH + (rows - values.length) * rowH / 2;
  const midY = 40 + (rows * rowH) / 2 - rowH / 2;
  const resolved = result.reconciliation_status === "RESOLVED";
  const groups = result.groups.filter((g) => g.source_ids.length > 1);
  const indexOf = (sid: string) => result.evidence.findIndex((e) => e.source_id === sid);
  const summary = `${RECONCILIATION[result.reconciliation_status].label}. ${result.summary}.`;

  return (
    <div>
      {/* wide screens */}
      <svg viewBox={`0 0 960 ${height}`} className="hidden w-full md:block" role="img" aria-labelledby="cg-title cg-desc">
        <title id="cg-title">Conflict graph</title>
        <desc id="cg-desc">{summary}</desc>

        {/* publisher groups: several sources, one voice */}
        {groups.map((g) => {
          const ys = g.source_ids.map((s) => srcY(indexOf(s)));
          const top = Math.min(...ys) - 8;
          const bottom = Math.max(...ys) + 44;
          return (
            <g key={g.group}>
              <rect x={214} y={top} width={272} height={bottom - top} fill="none" stroke="var(--color-amber)"
                    strokeDasharray="2 4" />
              <text x={220} y={top - 5} fontSize="10" fill="var(--color-amber)" fontFamily="var(--font-mono)">
                one voice: {g.group}
              </text>
            </g>
          );
        })}

        {/* question -> sources */}
        {result.evidence.map((e, i) => (
          <line key={`q-${e.source_id}`} x1={170} y1={midY + 18} x2={230} y2={srcY(i) + 18}
                stroke="var(--color-hairline)" />
        ))}

        {/* sources -> claimed values */}
        {result.evidence.map((e, i) => {
          const counted = e.evidence_status === "SUPPORTING" || e.evidence_status === "CONFLICTING" || e.evidence_status === "UNCONTESTED";
          const v = values.indexOf(counted ? e.claim_value : NONE_KEY);
          const tone = edgeTone(e.evidence_status);
          return (
            <path key={`e-${e.source_id}`} d={`M470 ${srcY(i) + 18} C 515 ${srcY(i) + 18}, 515 ${valY(v) + 18}, 560 ${valY(v) + 18}`}
                  fill="none" stroke={tone.stroke} strokeWidth={1.5} strokeDasharray={tone.dash} />
          );
        })}

        {/* derivations: this source repeats that one */}
        {result.evidence.filter((e) => e.derived_from).map((e) => {
          const a = srcY(indexOf(e.source_id)) + 18;
          const b = srcY(indexOf(e.derived_from)) + 18;
          return (
            <g key={`d-${e.source_id}`}>
              <path d={`M230 ${a} C 188 ${a}, 188 ${b}, 230 ${b}`} fill="none" stroke="var(--color-amber)" strokeDasharray="3 3" />
              <text x={176} y={(a + b) / 2 + 3} fontSize="9.5" fill="var(--color-amber)" fontFamily="var(--font-mono)"
                    textAnchor="end">derived</text>
            </g>
          );
        })}

        {/* values -> result */}
        {values.filter((v) => v !== NONE_KEY).map((v) => {
          const i = values.indexOf(v);
          const wins = resolved && result.state !== "UNRESOLVED" &&
            result.evidence.some((e) => e.claim_value === v && e.evidence_status === "SUPPORTING");
          return (
            <line key={`r-${v}`} x1={720} y1={valY(i) + 18} x2={790} y2={midY + 18}
                  stroke={wins ? "var(--color-support)" : "var(--color-edge-strong)"} strokeDasharray={wins ? "" : "4 4"} />
          );
        })}

        {/* nodes */}
        <g>
          <rect x={20} y={midY} width={150} height={36} fill="var(--color-slate)" stroke="var(--color-edge)" />
          <text x={30} y={midY + 15} fontSize="9.5" fill="var(--color-muted)" fontFamily="var(--font-mono)">QUESTION</text>
          <text x={30} y={midY + 29} fontSize="11" fill="var(--color-warm)">{question.length > 22 ? question.slice(0, 21) + "…" : question}</text>
        </g>
        {result.evidence.map((e, i) => (
          <g key={`s-${e.source_id}`}>
            <rect x={230} y={srcY(i)} width={240} height={36} fill="var(--color-graphite)"
                  stroke={e.availability === "AVAILABLE" ? "var(--color-edge)" : "var(--color-hairline)"} />
            <text x={240} y={srcY(i) + 15} fontSize="9.5" fill="var(--color-amber)" fontFamily="var(--font-mono)">
              {e.source_id} · {e.source_class === "DERIVED" ? "DERIVED" : e.declared_class}
            </text>
            <text x={240} y={srcY(i) + 29} fontSize="11" fill={e.availability === "AVAILABLE" ? "var(--color-warm)" : "var(--color-muted)"}>
              {hostLabel(e.source_url)} · {EVIDENCE[e.evidence_status].label.toLowerCase()}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <g key={`v-${v}`}>
            <rect x={560} y={valY(i)} width={160} height={36} fill="var(--color-slate)" stroke="var(--color-edge)" />
            <text x={570} y={valY(i) + 15} fontSize="9.5" fill="var(--color-muted)" fontFamily="var(--font-mono)">
              {v === NONE_KEY ? "NOT COUNTED" : "CLAIM"}
            </text>
            <text x={570} y={valY(i) + 29} fontSize="11" fill="var(--color-warm)">
              {v === NONE_KEY ? "no usable claim" : stateWords(v, rt.kind, rt.unit)}
            </text>
          </g>
        ))}
        <g>
          <rect x={790} y={midY - 14} width={150} height={64} fill="var(--color-slate)"
                stroke={resolved ? "var(--color-support)" : "var(--color-amber)"} />
          <text x={800} y={midY + 2} fontSize="9.5" fill="var(--color-muted)" fontFamily="var(--font-mono)">
            {POLICY[result.policy.kind].label.toUpperCase()}
          </text>
          <text x={800} y={midY + 20} fontSize="13" fontWeight={600} fill={resolved ? "var(--color-support)" : "var(--color-amber)"}>
            {stateWords(result.state, rt.kind, rt.unit)}
          </text>
          <text x={800} y={midY + 38} fontSize="9.5" fill="var(--color-muted)" fontFamily="var(--font-mono)">
            {resolved ? "RESOLVED" : result.reconciliation_status === "UNRESOLVED_CONFLICT" ? "CONFLICT" : "INSUFFICIENT"}
          </text>
        </g>
      </svg>

      {/* narrow screens: the same relationships as a list */}
      <ConflictList result={result} className="md:hidden" />
    </div>
  );
}

export function ConflictList({ result, className = "" }: { result: ReconResult; className?: string }) {
  const rt = result.result_type;
  const values = valueNodes(result);
  const resolved = result.reconciliation_status === "RESOLVED";
  return (
    <div className={`grid gap-3 ${className}`}>
      {values.map((v) => {
        const members = result.evidence.filter((e) => {
          const counted = e.evidence_status === "SUPPORTING" || e.evidence_status === "CONFLICTING" || e.evidence_status === "UNCONTESTED";
          return (counted ? e.claim_value : NONE_KEY) === v;
        });
        const wins = resolved && members.some((e) => e.evidence_status === "SUPPORTING");
        return (
          <div key={v} className={`border px-3 py-2.5 ${wins ? "border-support/60" : "border-hairline"}`}>
            <p className="label">{v === NONE_KEY ? "Not counted" : wins ? "Establishes the state" : "Claims"}</p>
            <p className="mt-0.5 text-sm font-semibold">{v === NONE_KEY ? "No usable claim" : stateWords(v, rt.kind, rt.unit)}</p>
            <ul className="mt-2 grid gap-1">
              {members.map((e) => (
                <li key={e.source_id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="mono text-amber">{e.source_id}</span>
                  <span className="text-warm">{hostLabel(e.source_url)}</span>
                  <span className="text-muted">
                    {EVIDENCE[e.evidence_status].label.toLowerCase()}
                    {e.derived_from ? `, repeats ${e.derived_from}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {result.groups.filter((g) => g.source_ids.length > 1).map((g) => (
        <p key={g.group} className="text-xs text-muted">
          <span className="mono text-amber">{g.source_ids.join(" + ")}</span> share a publisher ({g.group}) and count as one voice.
        </p>
      ))}
    </div>
  );
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
