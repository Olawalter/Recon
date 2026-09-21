import type { BondStatus, EvidenceStatus, Freshness, PolicyKind, ReconciliationStatus, Recon, RequestStatus,
  ResultKind, SourceClass } from "@/lib/genlayer/recon";

/**
 * Every word the interface says about contract state. Components never print
 * an enum or a raw number: they ask here, so a state is always described the
 * same way and in full sentences where a sentence is needed.
 */

export const REQUEST_STATUS: Record<RequestStatus, string> = {
  SUBMITTED: "Awaiting observation",
  PROPOSED: "Result pending finality",
  FINALIZED: "Final result recorded",
  CLOSED: "Closed",
  FAILED: "Closed without a result",
  CANCELLED: "Cancelled",
};

export const RECONCILIATION: Record<ReconciliationStatus, { label: string; meaning: string }> = {
  RESOLVED: { label: "Resolved", meaning: "Enough independent sources agree under the policy." },
  UNRESOLVED_CONFLICT: {
    label: "Unresolved: conflict",
    meaning: "Qualifying independent sources disagree, and the policy does not let one side prevail.",
  },
  UNRESOLVED_INSUFFICIENT: {
    label: "Unresolved: insufficient evidence",
    meaning: "Too few current, independent sources answered for the policy to establish a state.",
  },
};

export const EVIDENCE: Record<EvidenceStatus, { label: string; meaning: string }> = {
  SUPPORTING: { label: "Supports", meaning: "Counted, and states the reconciled value." },
  CONFLICTING: { label: "Conflicts", meaning: "Counted, and states something else." },
  UNCONTESTED: { label: "Uncontested", meaning: "Counted and agrees with every other counted source, but too few counted." },
  NO_CLAIM: { label: "No claim", meaning: "Readable, but does not answer the question." },
  EXCLUDED: { label: "Not counted", meaning: "Answers, but its freshness keeps it out under this policy." },
  UNAVAILABLE: { label: "Unavailable", meaning: "Could not be read. Never counted as a contradiction." },
};

export const FRESHNESS: Record<Freshness, { label: string; meaning: string }> = {
  CURRENT: { label: "Current", meaning: "Within the freshness requirement, or age is not a condition." },
  STALE: { label: "Stale", meaning: "Older than allowed, or it gives no date to show it is current." },
  UNAVAILABLE: { label: "Unavailable", meaning: "Could not be read." },
  CONFLICTING: { label: "Date conflicts", meaning: "The source dates its information after the observation itself." },
};

export const SOURCE_CLASS: Record<SourceClass, string> = {
  OFFICIAL: "Official (declared)",
  INDEPENDENT: "Independent (declared)",
  DERIVED: "Derived",
  UNKNOWN: "Undeclared",
};

export const BOND_STATUS: Record<BondStatus, string> = {
  LOCKED: "Locked",
  REFUNDABLE: "Refundable",
  REFUNDED: "Refund emitted",
};

export const RESULT_KIND: Record<ResultKind, string> = {
  CATEGORICAL: "One of named values",
  BOOLEAN: "True or false",
  NUMERIC: "A number",
  TEMPORAL: "A date",
};

export const POLICY: Record<PolicyKind, { label: string; meaning: string }> = {
  MAJORITY: { label: "Majority", meaning: "More than half of the qualifying independent publishers agree." },
  THRESHOLD: { label: "Threshold", meaning: "At least a set share of the qualifying independent publishers agree." },
  AUTHORITY_CONFIRMATION: {
    label: "Authority confirmation",
    meaning: "The source declared official agrees with independent confirmation.",
  },
  STRICT: { label: "Strict", meaning: "Every qualifying independent publisher agrees; any contradiction leaves it unresolved." },
};

export function describePolicy(r: Pick<Recon, "policy">): string {
  const p = r.policy;
  const stale = p.stale_contributes ? " Stale evidence counts." : " Stale evidence does not count.";
  if (p.kind === "AUTHORITY_CONFIRMATION") {
    return `The official source must be confirmed by ${p.min_confirmations} other independent publisher(s).${stale}`;
  }
  if (p.kind === "THRESHOLD") {
    return `At least ${bpsToPercent(p.threshold_bps ?? 0)} of the qualifying independent publishers, and no fewer than ${p.min_groups}, must agree.${stale}`;
  }
  if (p.kind === "STRICT") return `At least ${p.min_groups} independent publishers, all in agreement.${stale}`;
  return `More than half of the qualifying independent publishers, and at least ${p.min_groups}, must agree.${stale}`;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `${whole}${frac ? "." + String(frac).padStart(2, "0").replace(/0$/, "") : ""} per cent`;
}

// ── states ──────────────────────────────────────────────────────────────────

/** The reconciled value as a person reads it. */
export function stateWords(state: string, kind?: ResultKind, unit?: string): string {
  if (!state) return "No state yet";
  if (state === "UNRESOLVED") return "Unresolved";
  if (state === "EXPIRED") return "Expired";
  if (kind === "TEMPORAL" && /^\d{4}-\d{2}-\d{2}$/.test(state)) return formatDay(state);
  if (kind === "NUMERIC") return unit ? `${state} ${unit}` : state;
  if (kind === "BOOLEAN") return state === "TRUE" ? "True" : state === "FALSE" ? "False" : state;
  return state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");
}

// ── time ────────────────────────────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export function formatTime(unix: number): string {
  if (!unix) return "Not yet";
  const d = new Date(unix * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(s / 3600);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function relative(unix: number, now: number): string {
  const diff = unix - now;
  return diff >= 0 ? `in ${duration(diff)}` : `${duration(-diff)} ago`;
}

// ── money and identifiers ───────────────────────────────────────────────────

/** Atto to GEN, exactly, trailing zeros removed. */
export function formatGen(atto: string | bigint): string {
  const v = BigInt(atto);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} GEN`;
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

export const reconLabel = (id: string) => `RECON #${id.padStart(3, "0")}`;

export function resultLabel(resultId: string): string {
  const [rid, seq] = resultId.split("-R");
  return seq === "0" ? reconLabel(rid ?? "") : `${reconLabel(rid ?? "")}-R${seq}`;
}
