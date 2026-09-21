"""Mutation sweep: break one guard at a time in a scratch copy of the contract
and require the direct suite to fail. A surviving mutant is a guard no test
holds, unless it is listed in EQUIVALENT with the reason no call can reach it.

    python scripts/mutate.py                           # all mutants
    python scripts/mutate.py "duplicate refund"        # only the named ones

Exits non-zero on any survivor that is not a documented equivalent, and on any
mutant whose pattern does not match exactly once.
"""
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "contracts" / "recon.py").read_text(encoding="utf-8")

MUTANTS = [
    # ── creation ──
    ("zero bond accepted", "if sent <= 0:\n            raise gl.vm.UserError", "if False:\n            raise gl.vm.UserError"),
    ("bond floor removed", "if not MIN_BOND <= required <= MAX_BOND:", "if False:"),
    ("inexact bond accepted", "if sent != required:", "if False:"),
    ("a refused deposit is kept", "self._send_gen(gl.message.sender_address, sent)", "pass"),
    ("question unchecked", 'question = _line(question_raw, "question", MAX_QUESTION)', "question = str(question_raw)"),
    ("source count unbounded", "if not MIN_SOURCES <= len(raw_sources) <= MAX_SOURCES:", "if False:"),
    ("plain http allowed", 'if not url.lower().startswith("https://"):', "if False:"),
    ("credentials or bare host allowed", 'if "@" in rest.split("/", 1)[0] or not host or "." not in host or " " in url:', "if False:"),
    ("a location listed twice", "if norm in seen:", "if False:"),
    ("any class may be declared", "if declared not in DECLARABLE_CLASSES:", "if False:"),
    ("same publisher is two origins", 'return "github:" + host[: -len(".github.io")]', "return host"),
    ("api host owner ignored", '"api.github.com": ("github", 1),', '"api.github.com": ("github", 0),'),
    ("second-level suffix ignored", 'if len(labels) >= 3 and labels[-2] in SECOND_LEVEL and len(labels[-1]) == 2:', "if False:"),
    ("reserved value allowed", "if v in RESERVED_VALUES:", "if False:"),
    ("repeated value allowed", "if v in clean:", "if False:"),
    ("tolerance unbounded", "if not 0 <= tolerance <= MAX_TOLERANCE_BPS:", "if False:"),
    ("authority without an official source", "if not officials:", "if False:"),
    ("policy needs more origins than exist", "if need > origins:", "if False:"),
    ("threshold may be a bare majority", "if not BPS // 2 < bps <= BPS:", "if False:"),
    ("window may start in the past", "if start < now - CLOCK_SKEW:", "if False:"),
    ("window may be too short", "if end - start < MIN_WINDOW:", "if False:"),
    ("validity unbounded", "if not MIN_VALIDITY <= validity <= MAX_VALIDITY:", "if False:"),

    ("a trailing-dot host is a second publisher", 'if host.endswith(".") or ".." in host or host.startswith("."):', "if False:"),
    ("a non-ASCII host is a second publisher", "if not host.isascii():", "if False:"),
    ("an IP host is a second publisher", 'if re.fullmatch(r"[0-9.]+", host) or host.startswith("["):', "if False:"),
    ("freshness under a day accepted", "if fresh != 0 and not DAY <= fresh <= MAX_FRESHNESS:",
     "if fresh != 0 and not MINUTE <= fresh <= MAX_FRESHNESS:"),
    ("a fence is deleted, not replaced", 'ANGLE_RUN.sub(" ", str(text or ""))', 'ANGLE_RUN.sub("", str(text or ""))'),

    # ── evidence ──
    ("an invalid category is accepted", 'if v not in result_type["values"]:', "if False:"),
    ("a non-number is accepted", "if not d.is_finite():", "if False:"),
    ("a claim needs no quote", 'if value != NONE and _grounded(quote, text) and _claim_grounded(value, quote, rtype):',
     "if value != NONE:"),
    ("a short quote grounds a claim", "return MIN_QUOTE <= len(quote) and _squash(quote) in _squash(text)",
     "return _squash(quote) in _squash(text)"),
    ("a number need not be written", "return any(abs(n - want) < step for n in _numbers_in(quote))", "return True"),
    ("a date need not be written", "return value in _dates_in(quote)", "return True"),
    ("a date need not be stated", 'if as_of and _grounded(as_quote, text) and as_of in _dates_in(as_quote):',
     "if as_of:"),
    ("derivation on the model's word", "if names or copies:", "if True:"),
    ("a short passage is a copy", "copies = len(d_quote) >= MIN_COPY and target", "copies = target"),
    ("a source derives from itself", "if target in ids and target != sid and _grounded(d_quote, text):",
     "if target in ids and _grounded(d_quote, text):"),
    ("an omitted source is tolerated", 'if not found:\n            raise', 'if False:\n            raise'),
    ("a source may be answered twice", "if len(found) > 1:", "if False:"),
    ("an answer about another source is taken", 'if str(item.get("source_id", "")).strip().upper() == sid:', "if True:"),
    ("a future date is current", "if dated and _day_start(dated) > _day_start(observed_day) + FUTURE_TOLERANCE:",
     "if False:"),
    ("an undated source is current", "elif not dated:\n                row[\"freshness\"] = F_STALE",
     "elif not dated:\n                row[\"freshness\"] = F_CURRENT"),
    ("age is never stale", "elif observed_at - _day_start(dated) > fresh_limit:", "elif False:"),
    ("last-modified ignored",
     '                            modified = http_date(header(getattr(resp, "headers", None), "last-modified"))\n                except',
     '                            modified = ""\n                except'),

    # ── reconciliation ──
    ("a derived source is its own voice", "root, hops = by_id[root[\"derived_from\"]], hops + 1", "break"),
    ("stale always counts", 'return r["freshness"] == F_STALE and policy["stale_contributes"]', 'return r["freshness"] == F_STALE'),
    ("unavailable counts", 'if r["availability"] != A_AVAILABLE or r["claim_value"] == NONE:\n            return False',
     'if r["claim_value"] == NONE:\n            return False'),
    ("a split publisher still speaks", "if len(clusters) == 1 else None", "if clusters else None"),
    ("majority needs no majority", "backing * 2 > n_groups", "backing * 2 >= n_groups"),
    ("majority ignores its minimum", "ok = best is not None and backing >= need and backing * 2 > n_groups",
     "ok = best is not None and backing * 2 > n_groups"),
    ("threshold ignored", 'backing * BPS >= policy["threshold_bps"] * n_groups', "True"),
    ("strict tolerates contradiction", "ok = best is not None and not disagreement and backing >= need",
     "ok = best is not None and backing >= need"),
    ("authority needs no confirmation", "if len(confirming) >= need:", "if True:"),
    ("authority confirms itself", "confirming = [g for g in support(target) if g not in official]",
     "confirming = support(target)"),
    ("disagreeing officials resolve", "if official and (None in official_claims or len(_cluster(official_claims, rtype)) > 1):",
     "if False:"),
    ("insufficiency does not gate", "sufficient = n_groups >= need", "sufficient = True"),
    ("numbers never agree loosely", "return abs(x - y) * BPS <= tolerance_bps * max(abs(x), abs(y))", "return False"),
    ("median is the maximum", "return ordered[(len(ordered) - 1) // 2]", "return ordered[-1]"),

    # ── consensus ──
    ("validators skip the state", '"state": "#" if numeric and res["state"] != UNRESOLVED else res["state"],', ""),
    ("validators skip the sources", '"supporting": res["supporting_sources"],\n        "conflicting": res["conflicting_sources"],', ""),
    ("validators skip the evidence", 'for r in res["evidence"]],\n    })', 'for r in res["evidence"]][:0],\n    })'),
    ("validators skip the groups", 'for g in res["groups"]],', 'for g in res["groups"]][:0],'),
    ("validators skip passages", "if not quotes_hold(leader, readable, rtype):", "if False:"),
    ("a passage need not be on the page", "if q and (sid not in readable or len(q) < MIN_QUOTE or _mask(q) not in _mask(readable[sid])):",
     "if False:"),
    ("a stored figure need not be in its passage",
     'if r.get("claim_value", NONE) != NONE and not _claim_grounded(r["claim_value"], r.get("claim", ""), rtype):',
     "if False:"),
    ("numbers are not compared", "if numeric and not agree(leader, mine, tolerance):", "if False:"),
    ("a leader error is always agreed", "return _handle_leader_error(leaders_res, leader_fn)", "return True"),

    # ── the lifecycle ──
    ("observe before the window", "if now < int(r.observation_window_start):", "if False:"),
    ("observe after the window", "if now > int(r.observation_window_end):", "if False:"),
    ("observe while pending", "if r.status not in (S_SUBMITTED, S_FINALIZED):\n            _fail(f\"a request can be observed",
     "if False:\n            _fail(f\"a request can be observed"),
    ("observations unspaced", "if int(r.last_observed_at) and now < int(r.last_observed_at) + MIN_OBSERVATION_INTERVAL:", "if False:"),
    ("results unbounded", "if int(r.result_count) >= MAX_RESULTS_PER_RECON:", "if False:"),
    ("finalize immediately", "if now < ready:", "if False:"),
    ("finalize without a pending result", "if r.status != S_PROPOSED:\n            _fail(f\"only a pending result",
     "if False:\n            _fail(f\"only a pending result"),
    ("expire early", "if now < int(rec[\"valid_until\"]):", "if False:"),
    ("expire twice", "if r.current_state == EXPIRED:", "if False:"),
    ("close while open", "if now <= int(r.observation_window_end):", "if False:"),
    ("close with a pending result", "if r.status == S_PROPOSED:\n            _fail(\"a pending result must be finalized",
     "if False:\n            _fail(\"a pending result must be finalized"),
    ("cancel by anyone", "if self._sender() != str(r.creator).lower():", "if False:"),
    ("cancel after observation", "if r.status != S_SUBMITTED or int(r.result_count) > 0:", "if False:"),

    # ── the bond ──
    ("refund while locked", "if r.bond_status != B_REFUNDABLE:", "if False:"),
    ("duplicate refund", "if held <= 0:\n            _fail(\"nothing is held for this request\")",
     "if False:\n            _fail(\"nothing is held for this request\")"),
    ("ledger zeroed after the transfer",
     "        r.bond_deposited = u256(0)\n        r.bond_status = B_REFUNDED",
     "        r.bond_status = B_REFUNDED"),
    ("refund to the caller", "self._send_gen(r.creator, held)", "self._send_gen(gl.message.sender_address, held)"),
    ("total bonded not released", "self.total_bonded = u256(int(self.total_bonded) - held)", "pass"),

    # ── reading a response ──
    ("a compressed body is not decompressed", 'if body[:2] == b"\\x1f\\x8b":', "if False:"),
    ("decompression unbounded", "if d.unconsumed_tail:\n                return None", "if False:\n                return None"),
    ("binary noise is readable", 'if text.count("\\ufffd") > max(8, len(text) // 50):', "if False:"),

    # ── the boundary ──
    ("the boundary accepts any shape", "if not _well_formed(res, terms):", "if False:"),
    ("the boundary accepts an unread row with a claim",
     'if unread and (r.get("claim_value") != NONE or r.get("claim") or r.get("derived_from")):', "if False:"),
    ("the boundary accepts an inconsistent unread row",
     'if unread != (r["freshness"] == F_UNAVAILABLE) or unread != (r["evidence_status"] == EV_UNAVAILABLE):', "if False:"),
    ("the boundary accepts a claim without a passage", 'if (r.get("claim_value") == NONE) != (r.get("claim", "") == ""):',
     "if False:"),
    ("the boundary accepts any state", "_fingerprint(res, terms[\"result_type\"][\"kind\"] == K_NUMERIC):\n            _fail(\"inconsistent",
     "_fingerprint(res, terms[\"result_type\"][\"kind\"] == K_NUMERIC) and False:\n            _fail(\"inconsistent"),
    ("the leader's summary and times are stored", "record[key] = rederived[key]", "record[key] = res[key]"),
    ("a leader's extra row fields are kept", "row = {k: e[k] for k in AGREED_ROW_FIELDS}", "row = dict(e)"),
    ("a leader's source address is kept", 'row.update({"source_id": s["source_id"], "source_url": s["url"]',
     'row.update({"source_id": s["source_id"], "source_url": e["source_url"]'),
    ("a leader's source class is trusted", '"source_class": C_DERIVED if e["derived_from"] else s["declared_class"]',
     '"source_class": e["source_class"]'),
    ("the boundary accepts ill-typed fields", "if not isinstance(r.get(k), str) or len(r[k]) > MAX_QUOTE:", "if False:"),
    ("the boundary accepts any date text", r'if r[k] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[k]):', "if False:"),
    ("the boundary accepts any claim value",
     'if _normalize_claim(r["claim_value"], terms["result_type"]) != r["claim_value"]:', "if False:"),
    ("the boundary accepts a non-row", "not all(isinstance(r, dict) for r in rows)", "False"),
]

# Guards that no public call can reach, kept as defence in depth. Removing one
# changes no observable behaviour, so no test can kill it; each reason says why.
EQUIVALENT = {
    "unavailable counts":
        "a claim is only ever read for a source this node read, so an unreadable row always carries NONE and is "
        "refused by the claim check; the boundary also refuses an unread row that claims anything",
    "duplicate refund":
        "refund_bond first requires bond_status REFUNDABLE, which the first refund replaces with REFUNDED; a "
        "refundable request always holds its bond (creation requires one), and _send_gen refuses a zero amount",
}


def main() -> int:
    only = set(sys.argv[1:])
    unknown = only - {name for name, _, _ in MUTANTS}
    if unknown:
        print(f"no such mutant: {', '.join(sorted(unknown))}")
        return 2
    chosen = [m for m in MUTANTS if not only or m[0] in only]
    survivors, bad = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for name, old, new in chosen:
            if SOURCE.count(old) != 1:
                print(f"BAD MUTANT {name!r}: pattern found {SOURCE.count(old)} times", flush=True)
                bad.append(name)
                continue
            path = pathlib.Path(tmp) / "recon.py"
            path.write_bytes(SOURCE.replace(old, new).encode("utf-8"))
            env = {**os.environ, "RECON_CONTRACT": str(path), "PYTHONUTF8": "1"}
            proc = subprocess.run([sys.executable, "-m", "pytest", "tests/direct", "-q", "-x", "-p", "no:cacheprovider"],
                                  cwd=ROOT, env=env, capture_output=True, text=True)
            killed = proc.returncode != 0
            print(f"{'killed  ' if killed else 'SURVIVED'} {name}", flush=True)
            if not killed:
                survivors.append(name)
    equivalent = [s for s in survivors if s in EQUIVALENT]
    real = [s for s in survivors if s not in EQUIVALENT]
    ran = len(chosen) - len(bad)
    print(f"\n{ran - len(survivors)}/{ran} mutants killed, {len(equivalent)} documented equivalent, "
          f"{len(real)} undocumented" + (f", {len(bad)} bad pattern(s)" if bad else ""))
    for s in equivalent:
        print(f"  equivalent  {s}: {EQUIVALENT[s]}")
    for s in real:
        print(f"  SURVIVOR    {s}")
    return 1 if real or bad else 0


if __name__ == "__main__":
    sys.exit(main())
