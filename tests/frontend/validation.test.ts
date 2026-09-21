/**
 * The create form's rules mirror the contract's, so a mistake shows while
 * typing. The origin vectors are the contract's own test vectors
 * (tests/direct/test_creation.py): the form must group sources exactly as the
 * contract will.
 */
import { describe, expect, it } from "vitest";

import { preflight } from "@/lib/genlayer/preflight";
import { blankDraft, originOf, percentToBps, termsFromDraft, toAtto, validateDraft, type Draft } from "@/lib/validation/request";

const NOW = 1_790_000_000;
const good = (): Draft => ({
  ...blankDraft(NOW),
  question: "Is the Northwind API operational?",
  sources: [
    { url: "https://status.northwind.test/api", label: "Status", declared_class: "OFFICIAL" },
    { url: "https://monitor.watchtower.test/nw", label: "", declared_class: "INDEPENDENT" },
  ],
});

describe("origins, exactly as the contract decides them", () => {
  it.each([
    ["https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/README.md", "github:genlayerlabs"],
    ["https://api.github.com/repos/genlayerlabs/genlayer-js/releases/tags/v1.1.8", "github:genlayerlabs"],
    ["https://github.com/genlayerlabs/genlayer-js/releases", "github:genlayerlabs"],
    ["https://genlayerlabs.github.io/docs/", "github:genlayerlabs"],
    ["https://cdn.jsdelivr.net/gh/genlayerlabs/genlayer-js@v1.1.8/README.md", "github:genlayerlabs"],
    ["https://registry.npmjs.org/genlayer-js/latest", "npm:genlayer-js"],
    ["https://cdn.jsdelivr.net/npm/genlayer-js@1.1.8/package.json", "npm:genlayer-js"],
    ["https://www.npmjs.com/package/genlayer-js", "npm:genlayer-js"],
    ["https://peps.python.org/pep-0693/", "python.org"],
    ["https://www.python.org/downloads/release/python-3120/", "python.org"],
    ["https://www.bbc.co.uk/news", "bbc.co.uk"],
    ["https://github.com", "github"],
  ])("%s -> %s", (url, origin) => {
    expect(originOf(url)).toBe(origin);
  });
});

describe("request validation", () => {
  it("accepts a complete request", () => {
    expect(validateDraft(good(), NOW)).toEqual({});
  });

  it("refuses a missing question, too few sources, plain http and a repeated source", () => {
    expect(validateDraft({ ...good(), question: " " }, NOW).question).toMatch(/required/);
    expect(validateDraft({ ...good(), sources: [good().sources[0]!] }, NOW).sources).toMatch(/between 2 and 6/);
    const d = good();
    d.sources[1] = { ...d.sources[1]!, url: "http://monitor.watchtower.test/nw" };
    expect(validateDraft(d, NOW)["sources.1.url"]).toMatch(/https/);
    d.sources[1] = { ...d.sources[1]!, url: "HTTPS://Status.Northwind.test:443/api/?utm_source=x" };
    expect(validateDraft(d, NOW)["sources.1.url"]).toMatch(/repeats an earlier source/);
  });

  it("refuses a policy that needs more independent publishers than the sources give", () => {
    const d = { ...good(), minGroups: 3 };
    expect(validateDraft(d, NOW).minGroups).toMatch(/needs 3 independent publishers; the sources come from 2/);
  });

  it("refuses authority confirmation without an official source", () => {
    const d = { ...good(), policy: "AUTHORITY_CONFIRMATION" as const };
    d.sources = d.sources.map((s) => ({ ...s, declared_class: "INDEPENDENT" as const }));
    expect(validateDraft(d, NOW).policy).toMatch(/Declare one source OFFICIAL/);
  });

  it("refuses reserved or malformed categorical values", () => {
    expect(validateDraft({ ...good(), values: ["UP", "UNRESOLVED"] }, NOW).values).toMatch(/reserved/);
    expect(validateDraft({ ...good(), values: ["UP"] }, NOW).values).toMatch(/between 2 and 8/);
  });

  it("refuses a window in the past, a bond below the floor, and an unreadable bond", () => {
    expect(validateDraft({ ...good(), windowStart: NOW - 3600 }, NOW).window).toMatch(/cannot start in the past/);
    expect(validateDraft({ ...good(), bond: "0.0001" }, NOW).bond).toMatch(/at least 0.001 GEN/);
    expect(validateDraft({ ...good(), bond: "ten" }, NOW).bond).toMatch(/in GEN/);
  });
});

describe("bond and share arithmetic is exact", () => {
  it("converts GEN to atto without floating point", () => {
    expect(toAtto("0.01")).toBe("10000000000000000");
    expect(toAtto("1.000000000000000001")).toBe("1000000000000000001");
    expect(toAtto("0.1")).toBe("100000000000000000");
    expect(toAtto("1e3")).toBeNull();
  });

  it("converts percentages to integer basis points", () => {
    expect(percentToBps("66.67")).toBe(6667);
    expect(percentToBps("1")).toBe(100);
    expect(percentToBps("1.234")).toBeNull();
  });

  it("builds the terms the contract expects", () => {
    const t = termsFromDraft({ ...good(), policy: "THRESHOLD", thresholdPct: "75" });
    expect(t.policy).toEqual({ kind: "THRESHOLD", min_groups: 2, threshold_bps: 7500, stale_contributes: false });
    expect(t.result_type).toEqual({ kind: "CATEGORICAL", values: ["OPERATIONAL", "DEGRADED", "OFFLINE"] });
  });
});

describe("before any signature", () => {
  const connected = { status: "connected" as const, account: "0xabc", chainId: 61999, hasProvider: true };
  it("needs a connected wallet", () => {
    expect(preflight({ status: "disconnected", hasProvider: false }, 61999)?.message).toMatch(/Connect a wallet/);
  });
  it("refuses a wallet on another network", () => {
    expect(preflight({ ...connected, chainId: 1 }, 61999)?.kind).toBe("NETWORK_MISMATCH");
  });
  it("refuses an address that is not verified as RECON", () => {
    expect(preflight(connected, 61999, { ok: false, reason: "no" })?.kind).toBe("INVALID_REQUEST");
  });
  it("lets a verified, connected, correct-network write through", () => {
    expect(preflight(connected, 61999, { ok: true, version: "RECON-1.0.0" })).toBeNull();
  });
});

describe("one spelling per publisher, and freshness by the day, as the contract requires", () => {
  const withSecond = (url: string): Draft => {
    const d = good();
    d.sources = [d.sources[0]!, { url, label: "", declared_class: "INDEPENDENT" }];
    return d;
  };

  it.each([
    ["https://monitor.watchtower.test./nw", /trailing or doubled dot/],
    ["https://monitor..watchtower.test/nw", /trailing or doubled dot/],
    ["https://mönitor.watchtower.test/nw", /xn-- form/],
    ["https://93.184.216.34/nw", /not an IP address/],
  ])("refuses %s", (url, words) => {
    expect(validateDraft(withSecond(url), NOW)["sources.1.url"]).toMatch(words);
  });

  it("accepts the ordinary spelling", () => {
    expect(validateDraft(withSecond("https://monitor.watchtower.test/nw"), NOW)["sources.1.url"]).toBeUndefined();
  });

  it("refuses a requirement under a day and accepts one day", () => {
    expect(validateDraft({ ...good(), freshnessDays: "0.5" }, NOW).freshness).toMatch(/At least one day/);
    expect(validateDraft({ ...good(), freshnessDays: "1" }, NOW).freshness).toBeUndefined();
  });

  it("refuses a label that could rebuild a fence", () => {
    const d = good();
    d.sources[0]!.label = "status <<>>> x";
    expect(validateDraft(d, NOW)["sources.0.label"]).toMatch(/three angle brackets/);
  });
});
