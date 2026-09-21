import type { PolicyKind, ResultKind, TermsInput } from "@/lib/genlayer/recon";

/**
 * The create form's rules, mirroring contracts/recon.py so a mistake is shown
 * while typing. The contract checks every one of them again and is the only
 * authority: this module exists for the person filling the form, not for
 * trust.
 */

export const LIMITS = {
  minSources: 2,
  maxSources: 6,
  question: 300,
  label: 80,
  url: 400,
  unit: 24,
  minValues: 2,
  maxValues: 8,
  maxDecimals: 6,
  maxTolerancePct: 20,
  minWindowMinutes: 10,
  maxWindowDays: 366,
  maxFreshnessDays: 3650,
  minValiditySeconds: 60,
  maxValidityDays: 366,
  clockSkewSeconds: 300,
  minBondAtto: 10n ** 15n,
  maxBondAtto: 10n ** 24n,
} as const;

const TOKEN = /^[A-Z][A-Z0-9_]{0,31}$/;
const RESERVED = ["UNRESOLVED", "EXPIRED", "NONE"];
const ANGLE_RUN = /[<>]{3,}/;

export type DraftSource = { url: string; label: string; declared_class: "OFFICIAL" | "INDEPENDENT" | "UNKNOWN" };

export type Draft = {
  question: string;
  sources: DraftSource[];
  kind: ResultKind;
  values: string[];
  unit: string;
  decimals: number;
  tolerancePct: string;
  policy: PolicyKind;
  minGroups: number;
  minConfirmations: number;
  thresholdPct: string;
  staleContributes: boolean;
  windowStart: number;
  windowEnd: number;
  freshnessDays: string;
  validityHours: string;
  bond: string;
};

export type Problems = Record<string, string>;

export function blankDraft(now: number): Draft {
  const start = now - (now % 60) + 60;
  return {
    question: "",
    sources: [
      { url: "", label: "", declared_class: "UNKNOWN" },
      { url: "", label: "", declared_class: "UNKNOWN" },
    ],
    kind: "CATEGORICAL",
    values: ["OPERATIONAL", "DEGRADED", "OFFLINE"],
    unit: "",
    decimals: 0,
    tolerancePct: "1",
    policy: "MAJORITY",
    minGroups: 2,
    minConfirmations: 1,
    thresholdPct: "66.67",
    staleContributes: false,
    windowStart: start,
    windowEnd: start + 7 * 86400,
    freshnessDays: "0",
    validityHours: "24",
    bond: "0.01",
  };
}

// ── sources, as the contract groups them ────────────────────────────────────

export function hostOf(url: string): string {
  const rest = url.includes("://") ? url.split("://", 2)[1]! : url;
  const netloc = rest.split("/", 1)[0]!.split("?", 1)[0]!.split("#", 1)[0]!.toLowerCase();
  return netloc.split(":", 1)[0]!;
}

export function normalizeUrl(url: string): string {
  const [schemeRaw, restRaw = ""] = url.trim().split("://", 2);
  const slash = restRaw.indexOf("/");
  let netloc = (slash >= 0 ? restRaw.slice(0, slash) : restRaw).toLowerCase();
  let path = slash >= 0 ? restRaw.slice(slash + 1) : "";
  if (netloc.endsWith(":443")) netloc = netloc.slice(0, -4);
  if (netloc.startsWith("www.")) netloc = netloc.slice(4);
  path = path.split("#", 1)[0]!;
  const q = path.indexOf("?");
  const base = (q >= 0 ? path.slice(0, q) : path).replace(/\/+$/, "");
  const kept = q >= 0 ? path.slice(q + 1).split("&").filter((p) => p && !p.toLowerCase().startsWith("utm_")) : [];
  return `${(schemeRaw ?? "").toLowerCase()}://${netloc}/${base}` + (kept.length ? `?${kept.join("&")}` : "");
}

const PLATFORM_OWNER: Record<string, [string, number]> = {
  "github.com": ["github", 0],
  "raw.githubusercontent.com": ["github", 0],
  "gist.github.com": ["github", 0],
  "gist.githubusercontent.com": ["github", 0],
  "api.github.com": ["github", 1],
  "registry.npmjs.org": ["npm", 0],
  "unpkg.com": ["npm", 0],
};
const SECOND_LEVEL = ["co", "com", "org", "net", "gov", "ac", "edu"];

/** The publisher a location belongs to, exactly as the contract decides it. */
export function originOf(url: string): string {
  let host = hostOf(url);
  if (host.startsWith("www.")) host = host.slice(4);
  const rest = url.includes("://") ? url.split("://", 2)[1]! : url;
  const tail = rest.includes("/") ? rest.slice(rest.indexOf("/") + 1) : "";
  const path = tail.split("?", 1)[0]!.split("#", 1)[0]!.split("/").filter(Boolean);
  if (host.endsWith(".github.io")) return "github:" + host.slice(0, -".github.io".length);
  if (host === "cdn.jsdelivr.net" && path.length >= 2) {
    if (path[0] === "gh") return "github:" + path[1]!.toLowerCase();
    if (path[0] === "npm") return "npm:" + path[1]!.split("@", 1)[0]!.toLowerCase();
  }
  if (host === "npmjs.com" && path.length >= 2 && path[0] === "package") return "npm:" + path[1]!.toLowerCase();
  const platform = PLATFORM_OWNER[host];
  if (platform) {
    const [family, index] = platform;
    return path.length > index ? `${family}:${path[index]!.split("@", 1)[0]!.toLowerCase()}` : family;
  }
  const labels = host.split(".");
  if (labels.length >= 3 && SECOND_LEVEL.includes(labels[labels.length - 2]!) && labels[labels.length - 1]!.length === 2) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function originsOf(sources: DraftSource[]): string[] {
  return [...new Set(sources.filter((s) => s.url.trim()).map((s) => originOf(s.url.trim())))];
}

// ── money ───────────────────────────────────────────────────────────────────

/** GEN as typed, to atto, exactly: no floating point near a bond. */
export function toAtto(gen: string): string | null {
  const s = gen.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return (BigInt(whole!) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18))).toString();
}

export function percentToBps(pct: string): number | null {
  const s = pct.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

// ── the rules ───────────────────────────────────────────────────────────────

function line(value: string, limit: number, what: string, required = true): string | null {
  const s = value.replace(/\s+/g, " ").trim();
  if (required && !s) return `${what} is required.`;
  if (s.length > limit) return `${what} is longer than ${limit} characters.`;
  if (ANGLE_RUN.test(s)) return `${what} cannot contain three angle brackets in a row.`;
  return null;
}

export function validateDraft(d: Draft, now: number): Problems {
  const p: Problems = {};
  const q = line(d.question, LIMITS.question, "The question");
  if (q) p.question = q;

  if (d.sources.length < LIMITS.minSources || d.sources.length > LIMITS.maxSources) {
    p.sources = `Name between ${LIMITS.minSources} and ${LIMITS.maxSources} sources.`;
  }
  const seen = new Set<string>();
  d.sources.forEach((s, i) => {
    const url = s.url.trim();
    const key = `sources.${i}.url`;
    if (!url) p[key] = "Enter the source's address.";
    else if (url.length > LIMITS.url) p[key] = `At most ${LIMITS.url} characters.`;
    else if (!url.toLowerCase().startsWith("https://")) p[key] = "Use an https address.";
    else {
      const host = hostOf(url);
      const netloc = url.split("://", 2)[1]!.split("/", 1)[0]!;
      if (netloc.includes("@") || !host || !host.includes(".") || /\s/.test(url)) p[key] = "This is not a valid address.";
      // one spelling per publisher, as the contract requires
      else if (host.endsWith(".") || host.includes("..") || host.startsWith(".")) p[key] = "Remove the trailing or doubled dot from the host.";
      else if (/[^\x00-\x7f]/.test(host)) p[key] = "Give an internationalized host in its xn-- form.";
      else if (/^[0-9.]+$/.test(host)) p[key] = "Name a host, not an IP address.";
      else if (seen.has(normalizeUrl(url))) p[key] = "This repeats an earlier source.";
      else seen.add(normalizeUrl(url));
    }
    const l = line(s.label, LIMITS.label, "The label", false);
    if (l) p[`sources.${i}.label`] = l;
  });

  if (d.kind === "CATEGORICAL") {
    const values = d.values.map((v) => v.trim().toUpperCase()).filter(Boolean);
    if (values.length < LIMITS.minValues || values.length > LIMITS.maxValues) {
      p.values = `Name between ${LIMITS.minValues} and ${LIMITS.maxValues} values.`;
    } else if (values.some((v) => !TOKEN.test(v))) {
      p.values = "Each value is one word of capitals, digits or underscores, starting with a letter.";
    } else if (values.some((v) => RESERVED.includes(v))) {
      p.values = "UNRESOLVED, EXPIRED and NONE are reserved.";
    } else if (new Set(values).size !== values.length) {
      p.values = "A value is repeated.";
    }
  }
  if (d.kind === "NUMERIC") {
    const u = line(d.unit, LIMITS.unit, "The unit");
    if (u) p.unit = u;
    if (!Number.isInteger(d.decimals) || d.decimals < 0 || d.decimals > LIMITS.maxDecimals) {
      p.decimals = `Between 0 and ${LIMITS.maxDecimals} decimal places.`;
    }
    const bps = percentToBps(d.tolerancePct);
    if (bps === null || bps > LIMITS.maxTolerancePct * 100) p.tolerance = `A tolerance from 0 to ${LIMITS.maxTolerancePct} per cent.`;
  }

  const origins = originsOf(d.sources).length;
  if (d.policy === "AUTHORITY_CONFIRMATION") {
    const officials = d.sources.filter((s) => s.declared_class === "OFFICIAL" && s.url.trim());
    if (!officials.length) p.policy = "Declare one source OFFICIAL for authority confirmation.";
    const others = new Set(d.sources.filter((s) => s.url.trim()).map((s) => originOf(s.url.trim())));
    officials.forEach((s) => others.delete(originOf(s.url.trim())));
    if (!Number.isInteger(d.minConfirmations) || d.minConfirmations < 1 || d.minConfirmations > LIMITS.maxSources - 1) {
      p.minConfirmations = `Between 1 and ${LIMITS.maxSources - 1} confirmations.`;
    } else if (officials.length && others.size < d.minConfirmations) {
      p.minConfirmations = `The sources give ${others.size} publisher(s) besides the official one; ${d.minConfirmations} needed.`;
    }
  } else {
    if (!Number.isInteger(d.minGroups) || d.minGroups < LIMITS.minSources || d.minGroups > LIMITS.maxSources) {
      p.minGroups = `Between ${LIMITS.minSources} and ${LIMITS.maxSources} independent publishers.`;
    } else if (d.minGroups > origins) {
      p.minGroups = `The policy needs ${d.minGroups} independent publishers; the sources come from ${origins}.`;
    }
    if (d.policy === "THRESHOLD") {
      const bps = percentToBps(d.thresholdPct);
      if (bps === null || bps <= 5000 || bps > 10000) p.threshold = "A threshold above 50 and at most 100 per cent.";
    }
  }

  if (d.windowStart < now - LIMITS.clockSkewSeconds) p.window = "The observation window cannot start in the past.";
  else if (d.windowEnd - d.windowStart < LIMITS.minWindowMinutes * 60) p.window = `The window must last at least ${LIMITS.minWindowMinutes} minutes.`;
  else if (d.windowEnd - now > LIMITS.maxWindowDays * 86400) p.window = `The window must end within ${LIMITS.maxWindowDays} days.`;

  const fresh = Number(d.freshnessDays);
  if (!/^\d+(\.\d+)?$/.test(d.freshnessDays.trim()) || fresh > LIMITS.maxFreshnessDays) {
    p.freshness = `0 for any age, or up to ${LIMITS.maxFreshnessDays} days.`;
  } else if (fresh > 0 && fresh < 1) {
    p.freshness = "At least one day, or 0 for any age: sources date their information to the day.";
  }
  const validity = Number(d.validityHours) * 3600;
  if (!/^\d+(\.\d+)?$/.test(d.validityHours.trim()) || validity < LIMITS.minValiditySeconds || validity > LIMITS.maxValidityDays * 86400) {
    p.validity = `Between one minute and ${LIMITS.maxValidityDays} days.`;
  }

  const atto = toAtto(d.bond);
  if (atto === null) p.bond = "Enter the bond in GEN, like 0.01.";
  else if (BigInt(atto) < LIMITS.minBondAtto || BigInt(atto) > LIMITS.maxBondAtto) p.bond = "The bond must be at least 0.001 GEN.";
  return p;
}

export function termsFromDraft(d: Draft): TermsInput {
  const rt: TermsInput["result_type"] =
    d.kind === "CATEGORICAL"
      ? { kind: "CATEGORICAL", values: d.values.map((v) => v.trim().toUpperCase()).filter(Boolean) }
      : d.kind === "NUMERIC"
        ? { kind: "NUMERIC", unit: d.unit.trim(), decimals: d.decimals, tolerance_bps: percentToBps(d.tolerancePct) ?? 0 }
        : { kind: d.kind };
  const policy: TermsInput["policy"] =
    d.policy === "AUTHORITY_CONFIRMATION"
      ? { kind: d.policy, min_confirmations: d.minConfirmations, stale_contributes: d.staleContributes }
      : d.policy === "THRESHOLD"
        ? { kind: d.policy, min_groups: d.minGroups, threshold_bps: percentToBps(d.thresholdPct) ?? 0, stale_contributes: d.staleContributes }
        : { kind: d.policy, min_groups: d.minGroups, stale_contributes: d.staleContributes };
  return {
    sources: d.sources.map((s) => ({ url: s.url.trim(), label: s.label.replace(/\s+/g, " ").trim(), declared_class: s.declared_class })),
    result_type: rt,
    policy,
    observation_window_start: d.windowStart,
    observation_window_end: d.windowEnd,
    freshness_requirement: Math.round(Number(d.freshnessDays) * 86400),
    validity_seconds: Math.round(Number(d.validityHours) * 3600),
  };
}
