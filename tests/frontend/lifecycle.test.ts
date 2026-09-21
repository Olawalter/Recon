/**
 * The write lifecycle as the interface reports it: a step is ticked only on
 * evidence; a step GenLayer passed between two reads is shown as passed, not as
 * observed; and every failure is named precisely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "@/lib/genlayer/config";
import { refusalOf, rungsFor, runWrite, walletFailure, type TxState } from "@/lib/genlayer/tx";

const view = (s: TxState) => Object.fromEntries(rungsFor(s).map((r) => [r.step, r.state]));
const HASH = `0x${"ab".repeat(32)}` as const;
const config = { contractAddress: "0x895c056714414425F308dA6f65fBE4d4eCb8e775" } as unknown as AppConfig;
// a leader receipt's result payload: one code byte, then the contract's text
const payloadOf = (text: string) => btoa(String.fromCharCode(1) + text);

function harness(statuses: string[], reconciled: () => Promise<boolean | string> = async () => true,
                 write: () => Promise<string> = async () => HASH, receipt: Record<string, unknown> = {}) {
  const seen: TxState[] = [];
  let n = 0;
  const poller = { getTransaction: async () => ({ ...receipt, statusName: statuses[Math.min(n++, statuses.length - 1)] }) };
  const run = runWrite({ config, client: { writeContract: write } as never, poller: poller as never, pollMs: 1000,
                         functionName: "observe_recon", args: ["1"], value: 0n, reconciled, onUpdate: (s) => seen.push(s) });
  return { seen, run };
}

describe("runWrite", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a leader still proposing as in progress, not as validated", async () => {
    const { seen } = harness(["PENDING", "PROPOSING", "PROPOSING", "PROPOSING"], async () => false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(view(seen.at(-1)!)).toMatchObject({ PENDING: "observed", LEADER_PROPOSED: "current", VALIDATING: "todo",
                                                CONSENSUS: "todo" });
  });

  it("marks steps passed between two reads as passed, not observed", async () => {
    const { run } = harness(["PENDING", "ACCEPTED", "FINALIZED"]);
    await vi.advanceTimersByTimeAsync(120_000);
    const final = await run;
    expect(view(final)).toEqual({
      WALLET_CONFIRMATION: "observed", SUBMITTED: "observed", PENDING: "observed", LEADER_PROPOSED: "passed",
      VALIDATING: "observed", CONSENSUS: "observed", FINALIZED: "observed",
    });
    expect(final.statuses).toEqual(["PENDING", "ACCEPTED", "FINALIZED"]);
  });

  it("reaches consensus only when the contract's own state shows the write, and is not final until final", async () => {
    let caughtUp = false;
    const { seen } = harness(["ACCEPTED"], async () => caughtUp);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seen.at(-1)!.happened).toBe(5);
    caughtUp = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(view(seen.at(-1)!).CONSENSUS).toBe("observed");
    expect(view(seen.at(-1)!).FINALIZED).not.toBe("observed");
  });

  it("never lowers a step already reached when a later status is read", async () => {
    const { seen, run } = harness(["ACCEPTED", "ACCEPTED", "ACCEPTED", "FINALIZED"]);
    await vi.advanceTimersByTimeAsync(120_000);
    await run;
    const reached = seen.map((s) => s.happened);
    reached.forEach((h, i) => expect(h, `update ${i}: ${reached.join(",")}`).toBeGreaterThanOrEqual(reached[i - 1] ?? 0));
    expect(reached.at(-1)).toBe(7);
  });

  it("names a failed consensus", async () => {
    const { run } = harness(["PENDING", "UNDETERMINED"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await run).toMatchObject({ phase: "FAILED", failure: "NO_CONSENSUS" });
  });

  it("names a declined wallet, and sends nothing", async () => {
    const { run } = harness(["PENDING"], undefined, async () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    });
    expect(await run).toMatchObject({ phase: "FAILED", failure: "WALLET_REJECTED", happened: 0 });
  });

  it("names a model-parsing failure as one, from the leader's own receipt", async () => {
    const payload = payloadOf("[LLM_ERROR] answer omits readable source E3");
    const { run } = harness(["ACCEPTED"], undefined, undefined,
                            { consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { payload } }] } });
    await vi.advanceTimersByTimeAsync(10_000);
    const final = await run;
    expect(final).toMatchObject({ phase: "FAILED", failure: "LLM_PARSING" });
    expect(final.message).toMatch(/could not use the model's answer \(answer omits readable source E3\)/);
  });
});

describe("failures, named precisely", () => {
  it("wallet, balance and network", () => {
    expect(walletFailure({ message: "insufficient funds for gas * price + value" }).kind).toBe("INSUFFICIENT_GEN");
    expect(walletFailure({ code: 4001 }).kind).toBe("WALLET_REJECTED");
    expect(walletFailure({ message: "Provided chainId does not match the network" }).kind).toBe("NETWORK_MISMATCH");
    expect(walletFailure({ message: "boom" }).message).toMatch(/could not send the transaction: boom/);
  });

  it("the contract's own refusal sentence, without its tag", () => {
    const payload = payloadOf("[EXPECTED] the observation window closed at 1790000000");
    expect(refusalOf({ consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { payload } }] } }))
      .toEqual({ kind: "INVALID_REQUEST", message: "the observation window closed at 1790000000" });
    expect(refusalOf({ consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] } })).toBeNull();
  });
});

describe("the page is told when the contract shows the write", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls onRecorded once the contract's state shows it, before GenLayer's finality is seen", async () => {
    let recorded = 0;
    const seen: TxState[] = [];
    const poller = { getTransaction: async () => ({ statusName: "ACCEPTED" }) };      // never final
    void runWrite({ config, client: { writeContract: async () => HASH } as never, poller: poller as never, pollMs: 1000,
                    functionName: "observe_recon", args: ["1"], value: 0n, reconciled: async () => true,
                    onRecorded: () => { recorded++; }, onUpdate: (s) => seen.push(s) });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recorded).toBe(1);
    expect(seen.at(-1)!.phase).toBe("RUNNING");                                   // still waiting on finality
  });

  it("does not call it when the contract never shows the write", async () => {
    let recorded = 0;
    const poller = { getTransaction: async () => ({ statusName: "ACCEPTED" }) };
    const run = runWrite({ config, client: { writeContract: async () => HASH } as never, poller: poller as never, pollMs: 1000,
                           functionName: "observe_recon", args: ["1"], value: 0n, reconciled: async () => false,
                           onRecorded: () => { recorded++; }, onUpdate: () => {} });
    await vi.advanceTimersByTimeAsync(200_000);
    expect((await run).failure).toBe("STATE_NOT_CAUGHT_UP");
    expect(recorded).toBe(0);
  });
});
