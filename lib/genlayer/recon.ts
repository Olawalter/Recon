import { abi } from "genlayer-js";

import type { AppConfig } from "@/lib/genlayer/config";
import type { GenLayerClient } from "@/lib/genlayer/client";

/**
 * The schema-first adapter: the only module that knows the contract's method
 * names, parameters and answer shapes. Every answer is checked at the boundary
 * before a component sees it, so a different contract at the configured
 * address fails loudly here instead of rendering nonsense.
 */

// ── vocabulary (mirrors contracts/recon.py) ─────────────────────────────────

export const REQUEST_STATUSES = ["SUBMITTED", "PROPOSED", "FINALIZED", "CLOSED", "FAILED", "CANCELLED"] as const;
export const BOND_STATUSES = ["LOCKED", "REFUNDABLE", "REFUNDED"] as const;
export const RECONCILIATION_STATUSES = ["RESOLVED", "UNRESOLVED_CONFLICT", "UNRESOLVED_INSUFFICIENT"] as const;
export const AVAILABILITY = ["AVAILABLE", "MISSING", "UNAVAILABLE"] as const;
export const FRESHNESS = ["CURRENT", "STALE", "UNAVAILABLE", "CONFLICTING"] as const;
export const SOURCE_CLASSES = ["OFFICIAL", "INDEPENDENT", "DERIVED", "UNKNOWN"] as const;
export const DECLARABLE_CLASSES = ["OFFICIAL", "INDEPENDENT", "UNKNOWN"] as const;
export const EVIDENCE_STATUSES = ["SUPPORTING", "CONFLICTING", "UNCONTESTED", "NO_CLAIM", "EXCLUDED", "UNAVAILABLE"] as const;
export const RESULT_KINDS = ["CATEGORICAL", "BOOLEAN", "NUMERIC", "TEMPORAL"] as const;
export const POLICIES = ["MAJORITY", "THRESHOLD", "AUTHORITY_CONFIRMATION", "STRICT"] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type BondStatus = (typeof BOND_STATUSES)[number];
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
export type Freshness = (typeof FRESHNESS)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type SourceClass = (typeof SOURCE_CLASSES)[number];
export type ResultKind = (typeof RESULT_KINDS)[number];
export type PolicyKind = (typeof POLICIES)[number];

export type Source = { source_id: string; url: string; origin: string; label: string; declared_class: SourceClass };
export type ResultType = { kind: ResultKind; values?: string[]; unit?: string; decimals?: number; tolerance_bps?: number };
export type Policy = {
  kind: PolicyKind;
  stale_contributes: boolean;
  min_groups?: number;
  min_confirmations?: number;
  threshold_bps?: number;
};

export type Recon = {
  recon_id: string;
  creator: string;
  question: string;
  sources: Source[];
  result_type: ResultType;
  policy: Policy;
  observation_window_start: number;
  observation_window_end: number;
  freshness_requirement: number;
  validity_seconds: number;
  bond_required: string;
  bond_deposited: string;
  bond_status: BondStatus;
  status: RequestStatus;
  created_at: number;
  updated_at: number;
  current_state: string;
  latest_result_id: string;
  result_count: number;
  last_observed_at: number;
  next_observation_at: number;
  refunded_amount: string;
  refunded_at: number;
  policy_rules: string;
};

export type EvidenceReport = {
  source_id: string;
  source_url: string;
  origin: string;
  declared_class: SourceClass;
  source_class: SourceClass;
  availability: (typeof AVAILABILITY)[number];
  retrieved_at: number;
  published_at: string;
  updated_at: string;
  freshness: Freshness;
  claim: string;
  claim_type: ResultKind;
  claim_value: string;
  derived_from: string;
  derived_quote: string;
  as_of_quote: string;
  evidence_status: EvidenceStatus;
};

export type Group = { group: string; source_ids: string[]; claim: string };

export type ReconResult = {
  result_id: string;
  recon_id: string;
  sequence: number;
  status: "PROPOSED" | "FINALIZED";
  proposed_at: number;
  finalized_at: number;
  policy: Policy;
  result_type: ResultType;
  policy_rules: string;
  state: string;
  reconciliation_status: ReconciliationStatus;
  evidence_sufficient: boolean;
  supporting_sources: string[];
  conflicting_sources: string[];
  groups: Group[];
  observation_time: number;
  valid_until: number;
  summary: string;
  evidence: EvidenceReport[];
};

export type Transition = {
  recon_id: string;
  previous_state: string;
  new_state: string;
  result_id: string;
  finalized_at: number;
  kind: "OBSERVED" | "EXPIRED";
};

export type ReturnedDeposit = { sender: string; amount: string; reason: string; at: number };
export type Page<T> = { total: number; items: T[] };

export type ProtocolInfo = {
  protocol_version: string;
  policy_rules: string;
  recon_count: number;
  total_bonded: string;
  limits: Record<string, number | string>;
};

// ── the interface this app needs ────────────────────────────────────────────

export const REQUIRED_METHODS = {
  create_recon: ["question", "terms_json", "bond_required"],
  cancel_recon: ["recon_id"],
  observe_recon: ["recon_id"],
  finalize_result: ["recon_id"],
  expire_result: ["recon_id"],
  close_recon: ["recon_id"],
  refund_bond: ["recon_id"],
  get_protocol_info: [],
  get_recon: ["recon_id"],
  get_result: ["result_id"],
  get_results: ["recon_id", "offset", "limit"],
  get_history: ["recon_id", "offset", "limit"],
  list_recons: ["offset", "limit"],
  list_by_creator: ["creator", "offset", "limit"],
  list_transitions: ["offset", "limit"],
  get_returned_deposits: ["offset", "limit"],
  returned_for: ["sender", "offset", "limit"],
} as const;

/** The only payable method: the bond is the transaction value, never an argument. */
export const PAYABLE_METHODS = ["create_recon"] as const;

export type WriteMethod = "create_recon" | "cancel_recon" | "observe_recon" | "finalize_result" | "expire_result"
  | "close_recon" | "refund_bond";
export type VerbMethod = Exclude<WriteMethod, "create_recon">;

// ── reading, checked at the boundary ────────────────────────────────────────

function fail(fn: string): never {
  throw new Error(`The contract's ${fn} answer did not match the RECON interface.`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const inList = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  isStr(v) && (list as readonly string[]).includes(v);

export function checkRecon(v: unknown, fn: string): Recon {
  if (!isObject(v)) fail(fn);
  const r = v as unknown as Recon;
  if (!isStr(r.recon_id) || !isStr(r.creator) || !isStr(r.question)) fail(fn);
  if (!inList(REQUEST_STATUSES, r.status) || !inList(BOND_STATUSES, r.bond_status)) fail(fn);
  if (!isStr(r.bond_required) || !isStr(r.bond_deposited) || !isStr(r.current_state)) fail(fn);
  for (const k of ["observation_window_start", "observation_window_end", "created_at", "result_count"] as const) {
    if (!isNum(r[k])) fail(fn);
  }
  if (!Array.isArray(r.sources) || !isObject(r.result_type) || !isObject(r.policy)) fail(fn);
  if (!inList(RESULT_KINDS, r.result_type.kind) || !inList(POLICIES, r.policy.kind)) fail(fn);
  for (const s of r.sources) if (!isStr(s.source_id) || !isStr(s.url) || !inList(SOURCE_CLASSES, s.declared_class)) fail(fn);
  return r;
}

export function checkResult(v: unknown, fn: string): ReconResult {
  if (!isObject(v)) fail(fn);
  const r = v as unknown as ReconResult;
  if (!isStr(r.result_id) || !isStr(r.state) || !inList(RECONCILIATION_STATUSES, r.reconciliation_status)) fail(fn);
  if (r.status !== "PROPOSED" && r.status !== "FINALIZED") fail(fn);
  if (typeof r.evidence_sufficient !== "boolean" || !isNum(r.valid_until) || !isNum(r.proposed_at)) fail(fn);
  if (!Array.isArray(r.evidence) || !Array.isArray(r.groups)) fail(fn);
  if (!Array.isArray(r.supporting_sources) || !Array.isArray(r.conflicting_sources)) fail(fn);
  for (const e of r.evidence) {
    if (!isStr(e.source_id) || !inList(FRESHNESS, e.freshness) || !inList(EVIDENCE_STATUSES, e.evidence_status)) fail(fn);
    if (!inList(AVAILABILITY, e.availability) || !inList(SOURCE_CLASSES, e.source_class)) fail(fn);
  }
  return r;
}

export function checkTransition(v: unknown, fn: string): Transition {
  if (!isObject(v)) fail(fn);
  const t = v as unknown as Transition;
  if (!isStr(t.recon_id) || !isStr(t.new_state) || !isStr(t.previous_state) || !isNum(t.finalized_at)) fail(fn);
  if (t.kind !== "OBSERVED" && t.kind !== "EXPIRED") fail(fn);
  return t;
}

function checkPage<T>(v: unknown, fn: string, item: (x: unknown, fn: string) => T): Page<T> {
  if (!isObject(v) || !isNum(v.total) || !Array.isArray(v.items)) fail(fn);
  return { total: v.total, items: v.items.map((x) => item(x, fn)) };
}

async function view(client: GenLayerClient, config: AppConfig, fn: keyof typeof REQUIRED_METHODS,
                    args: (string | number)[]): Promise<unknown> {
  return client.readContract({ address: config.contractAddress, functionName: fn, args, jsonSafeReturn: true });
}

/** A view refusal ("does not exist") is an answer, not an outage. */
export function isMissing(err: unknown): boolean {
  return /does not exist/i.test(String((err as Error)?.message ?? err));
}

export const reads = {
  async protocol(c: GenLayerClient, cfg: AppConfig): Promise<ProtocolInfo> {
    const v = await view(c, cfg, "get_protocol_info", []);
    if (!isObject(v) || !isStr(v.protocol_version) || !isObject(v.limits)) fail("get_protocol_info");
    return v as unknown as ProtocolInfo;
  },
  async recon(c: GenLayerClient, cfg: AppConfig, id: string): Promise<Recon> {
    return checkRecon(await view(c, cfg, "get_recon", [id]), "get_recon");
  },
  async result(c: GenLayerClient, cfg: AppConfig, id: string): Promise<ReconResult> {
    return checkResult(await view(c, cfg, "get_result", [id]), "get_result");
  },
  async results(c: GenLayerClient, cfg: AppConfig, id: string, offset = 0, limit = 50): Promise<Page<ReconResult>> {
    return checkPage(await view(c, cfg, "get_results", [id, offset, limit]), "get_results", checkResult);
  },
  async history(c: GenLayerClient, cfg: AppConfig, id: string, offset = 0, limit = 50): Promise<Page<Transition>> {
    return checkPage(await view(c, cfg, "get_history", [id, offset, limit]), "get_history", checkTransition);
  },
  async list(c: GenLayerClient, cfg: AppConfig, offset = 0, limit = 50): Promise<Page<Recon>> {
    return checkPage(await view(c, cfg, "list_recons", [offset, limit]), "list_recons", checkRecon);
  },
  async byCreator(c: GenLayerClient, cfg: AppConfig, who: string, offset = 0, limit = 50): Promise<Page<Recon>> {
    return checkPage(await view(c, cfg, "list_by_creator", [who.toLowerCase(), offset, limit]), "list_by_creator", checkRecon);
  },
  async transitions(c: GenLayerClient, cfg: AppConfig, offset = 0, limit = 50): Promise<Page<Transition>> {
    return checkPage(await view(c, cfg, "list_transitions", [offset, limit]), "list_transitions", checkTransition);
  },
  async returnedFor(c: GenLayerClient, cfg: AppConfig, who: string, offset = 0, limit = 20): Promise<Page<ReturnedDeposit>> {
    const v = await view(c, cfg, "returned_for", [who.toLowerCase(), offset, limit]);
    if (!isObject(v) || !isNum(v.total) || !Array.isArray(v.items)) fail("returned_for");
    return v as unknown as Page<ReturnedDeposit>;
  },
};

// ── deployment validation ───────────────────────────────────────────────────

export type DeploymentCheck = { ok: true; version: string } | { ok: false; reason: string };

/** Does a contract schema expose every method this app calls, with the same
 * parameters in the same order, and exactly one payable method? */
export function checkSchema(schema: unknown): string | null {
  const methods = (schema as { methods?: Record<string, { params?: [string, string][]; payable?: boolean | null }> })?.methods;
  if (!methods || typeof methods !== "object") return "No contract schema exists at the configured address.";
  for (const [name, params] of Object.entries(REQUIRED_METHODS)) {
    const m = methods[name];
    if (!m) return `The contract at the configured address has no ${name} method, so it is not RECON.`;
    const names = (m.params ?? []).map((p) => p[0]);
    if (names.join(",") !== (params as readonly string[]).join(",")) {
      return `The contract's ${name} method takes different parameters than RECON's.`;
    }
  }
  for (const [name, m] of Object.entries(methods)) {
    const payable = Boolean(m.payable);
    const expected = (PAYABLE_METHODS as readonly string[]).includes(name);
    if (payable !== expected) return `The contract's ${name} method ${payable ? "accepts" : "refuses"} value, unlike RECON's.`;
  }
  return null;
}

export async function validateDeployment(c: GenLayerClient, cfg: AppConfig): Promise<DeploymentCheck> {
  let schema: unknown;
  try {
    schema = await c.getContractSchema(cfg.contractAddress);
  } catch {
    return { ok: false, reason: "No contract could be read at the configured address on this network." };
  }
  const problem = checkSchema(schema);
  if (problem) return { ok: false, reason: problem };
  try {
    const info = await reads.protocol(c, cfg);
    if (!info.protocol_version.startsWith("RECON")) {
      return { ok: false, reason: "The contract at the configured address does not identify itself as RECON." };
    }
    return { ok: true, version: info.protocol_version };
  } catch {
    return { ok: false, reason: "The contract at the configured address did not answer as RECON." };
  }
}

// ── writing ─────────────────────────────────────────────────────────────────

export type TermsInput = {
  sources: { url: string; label: string; declared_class: string }[];
  result_type: ResultType;
  policy: Policy;
  observation_window_start: number;
  observation_window_end: number;
  freshness_requirement: number;
  validity_seconds: number;
};

export type Call = { functionName: WriteMethod; args: (string | number | bigint)[]; value: bigint };

export function createCall(question: string, terms: TermsInput, bondAtto: string): Call {
  // the bond is attached as the transaction's value, and named once as its term
  return {
    functionName: "create_recon",
    args: [question, JSON.stringify(terms), BigInt(bondAtto)],
    value: BigInt(bondAtto),
  };
}

export function verbCall(fn: VerbMethod, reconId: string): Call {
  return { functionName: fn, args: [reconId], value: 0n };
}

// ── reconciliation predicates: the contract's own state shows the write ────

export function reconCreated(c: GenLayerClient, cfg: AppConfig, creator: string, known: number, knownReturned: number) {
  return async (): Promise<boolean | string> => {
    if ((await reads.byCreator(c, cfg, creator, 0, 1)).total > known) return true;
    const returned = await reads.returnedFor(c, cfg, creator, 0, 1);
    if (returned.total > knownReturned && returned.items[0]) {
      return `The contract did not create the request and sent the bond straight back: ${returned.items[0].reason}`;
    }
    return false;
  };
}

export function reconChanged(c: GenLayerClient, cfg: AppConfig, id: string, test: (r: Recon) => boolean) {
  return async (): Promise<boolean> => test(await reads.recon(c, cfg, id));
}

// ── transactions, found on chain ────────────────────────────────────────────

export type ChainTx = {
  hash: `0x${string}`;
  method: string;
  args: unknown[];
  status: string;
  execution: string;
  createdAt: string;
  /** GenLayer's consensus outcome, as recorded (for example MAJORITY_AGREE). */
  consensus: string;
  /** How the validators voted, as recorded: vote -> count. */
  votes: Record<string, number>;
};

type RawTx = {
  hash?: string;
  status?: string;
  created_at?: string;
  data?: { calldata?: string };
  result_name?: string;
  consensus_data?: {
    leader_receipt?: { execution_result?: string }[] | { execution_result?: string };
    votes?: Record<string, string>;
  };
};

function base64Bytes(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function decodeTx(t: RawTx): ChainTx | null {
  if (!t.hash || !t.data?.calldata) return null;
  let method = "";
  let args: unknown[] = [];
  try {
    const decoded = abi.calldata.decode(base64Bytes(t.data.calldata)) as unknown;
    const get = (k: string) => (decoded instanceof Map ? decoded.get(k) : (decoded as Record<string, unknown>)?.[k]);
    method = String(get("method") ?? "");
    const a = get("args");
    args = Array.isArray(a) ? a : [];
  } catch {
    return null;
  }
  const lr = t.consensus_data?.leader_receipt;
  const leader = Array.isArray(lr) ? lr[0] : lr;
  const votes: Record<string, number> = {};
  for (const v of Object.values(t.consensus_data?.votes ?? {})) votes[v] = (votes[v] ?? 0) + 1;
  return {
    hash: t.hash as `0x${string}`,
    method,
    args,
    status: t.status ?? "",
    execution: leader?.execution_result ?? "",
    createdAt: t.created_at ?? "",
    consensus: t.result_name ?? "",
    votes,
  };
}

/**
 * StudioNet lists the transactions sent to an address. Each is decoded from
 * its own calldata, so the app can show the real transaction behind every
 * result and refund, whoever sent it. Only StudioNet offers this listing; it
 * is read-only and used for display, never to decide anything.
 */
export async function contractTransactions(cfg: AppConfig): Promise<ChainTx[]> {
  const res = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sim_getTransactionsForAddress", params: [cfg.contractAddress] }),
  });
  const out = (await res.json()) as { result?: RawTx[] };
  return (out.result ?? []).map(decodeTx).filter((t): t is ChainTx => t !== null);
}

/** The transactions behind a request: the k-th successful observation is result R(k). */
export function transactionsFor(all: ChainTx[], reconId: string) {
  const mine = all
    .filter((t) => t.args[0] !== undefined && String(t.args[0]) === reconId && t.method !== "create_recon")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ok = (t: ChainTx) => t.execution === "SUCCESS";
  return {
    observations: mine.filter((t) => t.method === "observe_recon" && ok(t)),
    finalizations: mine.filter((t) => t.method === "finalize_result" && ok(t)),
    refund: mine.find((t) => t.method === "refund_bond" && ok(t)),
    all: mine,
  };
}
