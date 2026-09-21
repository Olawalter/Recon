/**
 * What the interface draws, rendered from REAL results recorded on StudioNet by
 * the live suite (fixtures/live-results.json). The graph and the map must show
 * exactly the relationships the contract recorded, and nothing it did not.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BondPanel } from "@/components/bond/bond-panel";
import { ConflictGraph, ConflictList } from "@/components/conflict-graph/conflict-graph";
import { LifecyclePanel } from "@/components/consensus/lifecycle-panel";
import { EvidenceMap } from "@/components/evidence/evidence-map";
import { StateHistory } from "@/components/recon/state-history";
import { bucketOf } from "@/components/recon/dashboard";
import { actsFor, pastValidity } from "@/lib/genlayer/acts";
import type { ChainTx, Recon, ReconResult, Transition } from "@/lib/genlayer/recon";
import fixtures from "./fixtures/live-results.json";

const majority = fixtures.majority.result as unknown as ReconResult;
const derived = fixtures.derived.result as unknown as ReconResult;
const grouped = fixtures.grouped.result as unknown as ReconResult;
const recon = fixtures.majority.recon as unknown as Recon;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("conflict graph", () => {
  it("draws the conflict the contract recorded, and resolves to its state", () => {
    const html = renderToStaticMarkup(<ConflictGraph result={majority} question={fixtures.question} />);
    expect(text(html)).toContain("2 October 2023");
    expect(text(html)).toContain("3 October 2023");                  // the conflicting claim is drawn
    expect(html).toContain("var(--color-conflict)");                 // with a conflict edge
    expect(text(html)).not.toContain("derived");                      // no derivation was recorded here
    expect(text(html)).not.toContain("one voice");
  });

  it("draws a derivation only where one was recorded", () => {
    const html = renderToStaticMarkup(<ConflictGraph result={derived} question={fixtures.question} />);
    expect(text(html)).toContain("derived");
    expect(text(html)).toContain("E3 · DERIVED");
  });

  it("boxes a publisher's several pages as one voice", () => {
    const html = renderToStaticMarkup(<ConflictGraph result={grouped} question={fixtures.question} />);
    expect(text(html)).toContain("one voice: python.org");
    const list = text(renderToStaticMarkup(<ConflictList result={grouped} />));
    expect(list).toContain("E1 + E2 share a publisher (python.org) and count as one voice");
    expect(list).toContain("No usable claim");                        // the missing page is not a claim
  });
});

describe("evidence map", () => {
  it("shows each source's recorded claim and the passage it rests on, never reasoning", () => {
    const html = text(renderToStaticMarkup(<EvidenceMap result={majority} question={fixtures.question} />));
    for (const e of majority.evidence) expect(html).toContain(e.claim.slice(0, 20));
    expect(html).toContain("Policy: Majority");
    expect(html).not.toMatch(/note|reasoning/i);
  });

  it("explains an unavailable source as unavailable, not as a contradiction", () => {
    const html = text(renderToStaticMarkup(<EvidenceMap result={grouped} question={fixtures.question} />));
    expect(html).toContain("does not exist");
    expect(html).toContain("never counted as a contradiction");
  });

  it("names a repeated source as counting with its origin", () => {
    const html = text(renderToStaticMarkup(<EvidenceMap result={derived} question={fixtures.question} />));
    expect(html).toContain("Repeats E2");
  });
});

describe("state history", () => {
  it("lists every finalized transition without rewriting any", () => {
    const history: Transition[] = [
      { recon_id: "1", previous_state: "", new_state: "2023-10-02", result_id: "1-R0", finalized_at: 1, kind: "OBSERVED" },
      { recon_id: "1", previous_state: "2023-10-02", new_state: "EXPIRED", result_id: "1-R0", finalized_at: 2, kind: "EXPIRED" },
      { recon_id: "1", previous_state: "EXPIRED", new_state: "2023-10-02", result_id: "1-R1", finalized_at: 3, kind: "OBSERVED" },
    ];
    const html = text(renderToStaticMarkup(<StateHistory history={history} kind="TEMPORAL" />));
    expect(html).toMatch(/No state .*2 October 2023.*RECON #001 finalized.*Expired.*expiry recorded.*RECON #001-R1 finalized/);
  });
});

describe("bond status", () => {
  const refunded = { ...recon, bond_status: "REFUNDED" as const, bond_deposited: "0", refunded_amount: recon.bond_required, refunded_at: 5 };
  const tx = (status: string): ChainTx => ({ hash: `0x${"cd".repeat(32)}`, method: "refund_bond", args: ["2"], status,
    execution: "SUCCESS", createdAt: "", consensus: "MAJORITY_AGREE", votes: {} });

  it("says emitted from contract state, and confirmed only when the refund transaction is final", () => {
    expect(text(renderToStaticMarkup(<BondPanel recon={refunded} refundTx={tx("ACCEPTED")} txLookup="found" />)))
      .toMatch(/Refund emitted.*accepted on GenLayer; the GEN moves when it is final/);
    expect(text(renderToStaticMarkup(<BondPanel recon={refunded} refundTx={tx("FINALIZED")} txLookup="found" />)))
      .toContain("Refund confirmed");
    expect(text(renderToStaticMarkup(<BondPanel recon={refunded} txLookup="missing" />)))
      .toContain("Refund confirmation unavailable");
  });

  it("does not call a refund minutes old lost while StudioNet's listing catches up", () => {
    expect(text(renderToStaticMarkup(<BondPanel recon={refunded} txLookup="found" now={5 + 30} />)))
      .toContain("Looking up the refund transaction");
    expect(text(renderToStaticMarkup(<BondPanel recon={refunded} txLookup="found" now={5 + 3600} />)))
      .toContain("Refund confirmation unavailable");
  });

  it("never presents the bond as weighing on the result", () => {
    expect(text(renderToStaticMarkup(<BondPanel recon={recon} txLookup="found" />))).toContain("never influences a result");
  });
});

describe("what can be done, and what is current", () => {
  const base = { ...recon, observation_window_start: 100, observation_window_end: 1000, next_observation_at: 0, result_count: 0 };
  const names = (acts: ReturnType<typeof actsFor>) => acts.filter((a) => a.available).map((a) => a.method);

  it("offers an observation only inside the window, and cancelling only to the creator", () => {
    expect(names(actsFor({ ...base, status: "SUBMITTED" }, undefined, 50))).toEqual([]);
    expect(names(actsFor({ ...base, status: "SUBMITTED" }, undefined, 500))).toEqual(["observe_recon"]);
    expect(names(actsFor({ ...base, status: "SUBMITTED" }, undefined, 500, recon.creator))).toContain("cancel_recon");
    expect(names(actsFor({ ...base, status: "SUBMITTED" }, undefined, 2000))).toEqual(["close_recon"]);
  });

  it("offers finality only after the delay, and a refund only when refundable", () => {
    const pending = { ...majority, status: "PROPOSED" as const, proposed_at: 400 };
    expect(names(actsFor({ ...base, status: "PROPOSED" }, pending, 699))).toEqual([]);
    expect(names(actsFor({ ...base, status: "PROPOSED" }, pending, 700))).toEqual(["finalize_result"]);
    expect(names(actsFor({ ...base, status: "CLOSED", bond_status: "REFUNDABLE" }, undefined, 2000))).toEqual(["refund_bond"]);
  });

  it("never shows a result past its validity as current", () => {
    const final = { ...majority, status: "FINALIZED" as const, valid_until: 600 };
    expect(pastValidity({ ...base, status: "FINALIZED", current_state: "2023-10-02" }, final, 599)).toBe(false);
    expect(pastValidity({ ...base, status: "FINALIZED", current_state: "2023-10-02" }, final, 600)).toBe(true);
    expect(pastValidity({ ...base, status: "FINALIZED", current_state: "EXPIRED" }, final, 600)).toBe(false);
  });

  it("groups the dashboard by what the contract records", () => {
    expect(bucketOf({ ...base, status: "SUBMITTED", current_state: "" })).toBe("active");
    expect(bucketOf({ ...base, status: "FINALIZED", current_state: "2023-10-02" })).toBe("finalized");
    expect(bucketOf({ ...base, status: "FINALIZED", current_state: "UNRESOLVED" })).toBe("unresolved");
    expect(bucketOf({ ...base, status: "CLOSED", current_state: "EXPIRED" })).toBe("expired");
  });
});

describe("the GenLayer lifecycle", () => {
  const stage = (html: string, name: string) => {
    const t = text(html);
    const i = t.indexOf(name);
    return t.slice(i, i + name.length + 12);
  };

  it("never shows consensus reached while its proposal and vote read as not yet", () => {
    const html = renderToStaticMarkup(<LifecyclePanel recon={recon} result={majority} txLookup="loading" />);
    expect(stage(html, "Consensus")).toContain(", done");
    expect(stage(html, "Leader proposed")).toContain(", done");
    expect(stage(html, "Validating")).toContain(", done");
    expect(text(html)).toContain("is still being read");
    expect(stage(html, "Finality")).toContain(", not yet");
  });

  it("shows the votes the transaction recorded once it is read", () => {
    const tx: ChainTx = { hash: "0xabc", method: "observe_recon", args: [recon.recon_id], status: "FINALIZED", execution: "SUCCESS",
                          createdAt: "", consensus: "MAJORITY_AGREE", votes: { agree: 3, idle: 2 } };
    const html = text(renderToStaticMarkup(<LifecyclePanel recon={recon} result={majority} tx={tx} txLookup="found" />));
    expect(html).toContain("3 agree, 2 idle");
  });

  it("claims nothing before an observation", () => {
    const html = renderToStaticMarkup(<LifecyclePanel recon={recon} txLookup="found" />);
    for (const s of ["Observing", "Leader proposed", "Validating", "Consensus", "Finality"]) expect(stage(html, s)).toContain(", not yet");
  });
});
