import type { AppConfig } from "@/lib/genlayer/config";
import { readClient, type GenLayerClient } from "@/lib/genlayer/client";

/**
 * The frontend transaction lifecycle.
 *
 * Each step names something that has to HAPPEN, and is marked done only on
 * evidence:
 *
 *   WALLET_CONFIRMATION  the wallet signed and returned a hash
 *   SUBMITTED            GenLayer itself can read the transaction back
 *   PENDING              GenLayer has queued it (status PENDING or later)
 *   LEADER_PROPOSED      the leader has proposed (status COMMITTING or later)
 *   VALIDATING           the validators have voted (status ACCEPTED or later)
 *   CONSENSUS            accepted, and the contract's own state shows the write
 *   FINALIZED            GenLayer marked the transaction final
 *
 * Polling can jump from PENDING straight to ACCEPTED. The steps in between
 * certainly happened, but were not seen: they are reported as passed, not as
 * observed, and the statuses actually read are kept. Nothing here is invented.
 */

export const STEPS = [
  "WALLET_CONFIRMATION",
  "SUBMITTED",
  "PENDING",
  "LEADER_PROPOSED",
  "VALIDATING",
  "CONSENSUS",
  "FINALIZED",
] as const;
export type Step = (typeof STEPS)[number];

export type TxState = {
  phase: "READY" | "RUNNING" | "DONE" | "FAILED";
  /** How many steps, in order, have happened. */
  happened: number;
  /** Steps whose evidence was read directly, rather than implied by a later status. */
  observed: Step[];
  /** GenLayer status names as they were read, in order. */
  statuses: string[];
  hash?: `0x${string}`;
  protocolStatus?: string;
  message?: string;
  /** What kind of failure, so the interface can say it precisely. */
  failure?: FailureKind;
};

export type FailureKind =
  | "WALLET_REJECTED"
  | "NETWORK_MISMATCH"
  | "INSUFFICIENT_GEN"
  | "INVALID_REQUEST"
  | "LLM_PARSING"
  | "NO_CONSENSUS"
  | "TRANSACTION_FAILED"
  | "STATE_NOT_CAUGHT_UP"
  | "TIMEOUT";

export const initialTx: TxState = { phase: "READY", happened: 0, observed: [], statuses: [] };

// GenLayer status -> how many steps it proves have happened
const EVIDENCE: Record<string, number> = {
  PENDING: 3,
  ACTIVATED: 3,
  PROPOSING: 3,
  COMMITTING: 4,
  REVEALING: 4,
  ACCEPTED: 5,
  APPEAL_REVEALING: 5,
  APPEAL_COMMITTING: 5,
  READY_TO_FINALIZE: 5,
  FINALIZED: 5,
};
const UNDECIDED = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

export function isAccepted(status: string | undefined): boolean {
  return !!status && (EVIDENCE[status] ?? 0) >= 5;
}

/** The step a status directly shows as happened, if any. */
function stepShownBy(status: string): Step | null {
  const n = EVIDENCE[status];
  return n ? STEPS[n - 1]! : null;
}

export type Rung = { step: Step; state: "observed" | "passed" | "current" | "todo" | "failed" };

/** Each step as a tracker should show it. */
export function rungsFor(s: TxState): Rung[] {
  return STEPS.map((step, i) => {
    if (i < s.happened) return { step, state: s.observed.includes(step) ? "observed" : "passed" };
    if (i === s.happened && s.phase === "FAILED") return { step, state: "failed" };
    if (i === s.happened && s.phase === "RUNNING") return { step, state: "current" };
    return { step, state: "todo" };
  });
}

// ── the contract's own refusal text ─────────────────────────────────────────

const TAGS = ["[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"];

function base64Text(s: string): string {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    let i = 0;
    while (i < text.length && text.charCodeAt(i) < 0x20) i++;
    return text.slice(i);
  } catch {
    return "";
  }
}

function findTagged(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    for (const candidate of [value, /^[A-Za-z0-9+/=]{8,}$/.test(value) ? base64Text(value) : ""]) {
      const hits = TAGS.map((t) => candidate.indexOf(t)).filter((i) => i >= 0);
      if (hits.length) return candidate.slice(Math.min(...hits)).split(/\r?\n/)[0]!.trim();
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findTagged(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export type Receipt = {
  statusName?: string;
  consensus_data?: {
    leader_receipt?:
      | { execution_result?: string; result?: unknown }[]
      | { execution_result?: string; result?: unknown };
  };
};

export function leaderOf(tx: Receipt) {
  const lr = tx.consensus_data?.leader_receipt;
  return Array.isArray(lr) ? lr[0] : lr;
}

/**
 * Why the contract refused a write, in words, or null when it executed. The
 * contract's own sentence is kept; a model-parsing failure is named as one.
 */
export function refusalOf(tx: Receipt): { message: string; kind: FailureKind } | null {
  const leader = leaderOf(tx);
  if (!leader || leader.execution_result !== "ERROR") return null;
  const tagged = findTagged(leader.result);
  if (tagged?.startsWith("[LLM_ERROR]")) {
    return {
      kind: "LLM_PARSING",
      message:
        "The validator panel could not use the model's answer (" +
        tagged.replace(/^\[LLM_ERROR\]\s*/, "") +
        "). Nothing was recorded; the request can be observed again.",
    };
  }
  return {
    kind: "INVALID_REQUEST",
    message: (tagged ?? "The contract refused this transaction.").replace(/^\[[A-Z_]+\]\s*/, ""),
  };
}

/** Wallet and transport failures, in words a person can act on. */
export function walletFailure(err: unknown): { message: string; kind: FailureKind } {
  const text = [
    (err as { shortMessage?: string })?.shortMessage,
    (err as { message?: string })?.message,
    (err as { details?: string })?.details,
  ]
    .filter(Boolean)
    .join(" ");
  const code = (err as { code?: number })?.code ?? (err as { cause?: { code?: number } })?.cause?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request|declined/i.test(text)) {
    return { kind: "WALLET_REJECTED", message: "You declined the request in your wallet. Nothing was sent." };
  }
  if (/insufficient funds|exceeds balance|insufficient balance/i.test(text)) {
    return {
      kind: "INSUFFICIENT_GEN",
      message: "This wallet does not hold enough GEN for the bond and the transaction. Nothing was sent.",
    };
  }
  if (/chain|network/i.test(text) && /mismatch|wrong|unsupported|does not match/i.test(text)) {
    return { kind: "NETWORK_MISMATCH", message: "The wallet is on a different network. Switch to StudioNet and try again." };
  }
  return {
    kind: "TRANSACTION_FAILED",
    message: `The wallet could not send the transaction${text ? `: ${text.slice(0, 160)}` : "."}`,
  };
}

// ── running a write ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RunOptions = {
  config: AppConfig;
  client: GenLayerClient;
  functionName: string;
  args: (string | number | bigint)[];
  value: bigint;
  /**
   * Resolves true once the contract's own views reflect the write, or a
   * sentence when they show the contract declined it without reverting (a
   * bond sent straight back, for instance).
   */
  reconciled: () => Promise<boolean | string>;
  /** Called the moment the contract's state shows the write, so the page can
   * re-read it then, not only once GenLayer's finality has also been seen. */
  onRecorded?: () => void;
  onUpdate: (s: TxState) => void;
  poller?: GenLayerClient;
  pollMs?: number;
};

export async function runWrite(o: RunOptions): Promise<TxState> {
  let state: TxState = { ...initialTx, phase: "RUNNING" };
  const set = (patch: Partial<TxState>) => {
    state = { ...state, ...patch };
    o.onUpdate(state);
    return state;
  };
  const see = (status: string | undefined) => {
    if (!status) return;
    const statuses = state.statuses.at(-1) === status ? state.statuses : [...state.statuses, status];
    const shown = stepShownBy(status);
    // a status proves at most VALIDATING; CONSENSUS needs the contract's own state
    const happened = Math.max(state.happened, Math.min(EVIDENCE[status] ?? 0, 5));
    const observed = shown && !state.observed.includes(shown) ? [...state.observed, shown] : state.observed;
    set({ protocolStatus: status, statuses, happened, observed });
  };
  const fail = (message: string, kind: FailureKind) => set({ phase: "FAILED", message, failure: kind });
  const poller = o.poller ?? readClient(o.config);
  const pollMs = o.pollMs ?? 3000;

  set({});
  let hash: `0x${string}`;
  try {
    hash = (await o.client.writeContract({
      address: o.config.contractAddress,
      functionName: o.functionName,
      args: o.args,
      value: o.value,
    })) as `0x${string}`;
  } catch (err) {
    const f = walletFailure(err);
    return fail(f.message, f.kind);
  }
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail("The wallet did not return a transaction hash.", "TRANSACTION_FAILED");
  set({ hash, happened: 1, observed: ["WALLET_CONFIRMATION"] });

  // SUBMITTED only once GenLayer itself can read the transaction back
  let tx: Receipt | null = null;
  for (let i = 0; i < 20 && !tx; i++) {
    try {
      tx = (await poller.getTransaction({ hash: hash as never })) as Receipt;
    } catch {
      await sleep(pollMs);
    }
  }
  if (!tx) return fail("The wallet returned a hash, but GenLayer has no record of the transaction.", "TRANSACTION_FAILED");
  set({ happened: 2, observed: [...state.observed, "SUBMITTED"] });
  see(tx.statusName);

  const started = Date.now();
  while (!isAccepted(tx.statusName)) {
    if (tx.statusName && UNDECIDED.has(tx.statusName)) {
      return fail("The validators did not reach consensus on this transaction, so it changed nothing.", "NO_CONSENSUS");
    }
    if (Date.now() - started > 20 * 60_000) {
      return fail("Consensus is taking longer than twenty minutes. The transaction may still complete; reload later.", "TIMEOUT");
    }
    await sleep(pollMs + 2000);
    try {
      tx = (await poller.getTransaction({ hash: hash as never })) as Receipt;
      see(tx.statusName);
    } catch {
      /* a transient read failure: keep polling */
    }
  }

  const refusal = refusalOf(tx);
  if (refusal) return fail(refusal.message, refusal.kind);

  // the contract's own state
  let updated = false;
  for (let i = 0; i < 40 && !updated; i++) {
    let outcome: boolean | string = false;
    try {
      outcome = await o.reconciled();
    } catch {
      outcome = false;
    }
    if (typeof outcome === "string") return fail(outcome, "INVALID_REQUEST");
    updated = outcome;
    if (!updated) await sleep(pollMs);
  }
  if (!updated) {
    return fail("The transaction was accepted, but the contract's state has not caught up yet. Reload in a minute.", "STATE_NOT_CAUGHT_UP");
  }
  set({ happened: 6, observed: [...state.observed, "CONSENSUS"] });
  o.onRecorded?.();

  // GenLayer's own finality, tracked after the flow unblocks
  for (let i = 0; i < 90 && state.protocolStatus !== "FINALIZED"; i++) {
    await sleep(10_000);
    try {
      const t = (await poller.getTransaction({ hash: hash as never })) as Receipt;
      see(t.statusName);
    } catch {
      /* keep the last known status */
    }
  }
  if (state.protocolStatus === "FINALIZED") {
    return set({ phase: "DONE", happened: 7, observed: [...state.observed, "FINALIZED"] });
  }
  return set({ phase: "DONE" });
}
