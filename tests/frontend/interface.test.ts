/**
 * The app's view of the contract, pinned to the deployed contract's own schema
 * (lib/genlayer/recon-schema.json, written by scripts/verify_deployment.py from
 * the deployment of record). A method renamed, a parameter reordered, or value
 * accepted where it should not be fails here, not in front of a user.
 */
import { describe, expect, it } from "vitest";

import schema from "@/lib/genlayer/recon-schema.json";
import { PAYABLE_METHODS, REQUIRED_METHODS, checkResult, checkSchema, createCall, verbCall } from "@/lib/genlayer/recon";
import fixtures from "./fixtures/live-results.json";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type SchemaView = { methods: Record<string, { params: [string, string][]; payable?: boolean | null }> };
const view = (v: unknown) => clone(v) as SchemaView;

describe("the deployed interface", () => {
  it("exposes every method the app calls, with the same parameters, and one payable method", () => {
    expect(checkSchema(schema)).toBeNull();
    expect(PAYABLE_METHODS).toEqual(["create_recon"]);
  });

  it("refuses a contract whose method is missing, reordered or payable where it should not be", () => {
    const missing = view(schema);
    delete missing.methods.observe_recon;
    expect(checkSchema(missing)).toMatch(/no observe_recon method/);

    const reordered = view(schema);
    reordered.methods.create_recon!.params.reverse();
    expect(checkSchema(reordered)).toMatch(/create_recon method takes different parameters/);

    const payable = view(schema);
    payable.methods.refund_bond!.payable = true;
    expect(checkSchema(payable)).toMatch(/refund_bond method accepts value/);
    expect(checkSchema(null)).toMatch(/No contract schema/);
  });

  it("names every required method with the deployed parameter names", () => {
    const methods = view(schema).methods;
    for (const [name, params] of Object.entries(REQUIRED_METHODS)) {
      expect(methods[name]!.params.map((p) => p[0]), name).toEqual(params);
    }
  });
});

describe("calls", () => {
  it("attaches the bond as the transaction's value, and names it once as the term", () => {
    const call = createCall("q?", {
      sources: [], result_type: { kind: "BOOLEAN" }, policy: { kind: "MAJORITY", min_groups: 2, stale_contributes: false },
      observation_window_start: 1, observation_window_end: 2, freshness_requirement: 0, validity_seconds: 60,
    }, "10000000000000000");
    expect(call.functionName).toBe("create_recon");
    expect(call.value).toBe(10_000_000_000_000_000n);
    expect(call.args[2]).toBe(10_000_000_000_000_000n);
    expect(JSON.parse(call.args[1] as string).result_type).toEqual({ kind: "BOOLEAN" });
  });

  it("sends every other write with no value", () => {
    for (const m of ["observe_recon", "finalize_result", "expire_result", "close_recon", "refund_bond", "cancel_recon"] as const) {
      expect(verbCall(m, "7")).toEqual({ functionName: m, args: ["7"], value: 0n });
    }
  });
});

describe("answers are checked at the boundary", () => {
  it("accepts a real result recorded on StudioNet", () => {
    expect(checkResult(fixtures.majority.result, "get_result").state).toBe("2023-10-02");
  });

  it("refuses a malformed result rather than rendering it", () => {
    const bad = clone(fixtures.majority.result) as Record<string, unknown>;
    bad.reconciliation_status = "PROBABLY";
    expect(() => checkResult(bad, "get_result")).toThrow(/did not match the RECON interface/);
    const worse = clone(fixtures.majority.result) as { evidence: { freshness: string }[] };
    worse.evidence[0]!.freshness = "FRESH";
    expect(() => checkResult(worse, "get_result")).toThrow();
  });
});
