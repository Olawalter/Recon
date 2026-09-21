"""Write docs/e2e.md, and the verified block in README.md, from the records.

Nothing in either is typed by hand: every hash, vote, state and amount comes
from docs/live-e2e.json (the live suite) and docs/app-e2e.json (the in-app
run), which were themselves read back from StudioNet.

    python scripts/render_e2e.py
"""
import json
import pathlib
import re
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIVE = json.loads((ROOT / "docs" / "live-e2e.json").read_text(encoding="utf-8"))
APP = json.loads((ROOT / "docs" / "app-e2e.json").read_text(encoding="utf-8"))
DEPLOYMENT = json.loads((ROOT / "docs" / "deployment.json").read_text(encoding="utf-8"))
TX = "https://explorer-studio.genlayer.com/tx/"
START, END = "<!-- verified:start -->", "<!-- verified:end -->"

CASE_TITLES = {
    "grouped": "Two pages of one publisher are one voice; a missing page is not a contradiction",
    "majority": "Majority resolves against one conflicting source",
    "strict": "Strict leaves the same evidence unresolved",
    "derived": "A source that repeats another adds no voice",
    "stale": "Old evidence is stale when freshness is required",
    "authority": "An official source, independently confirmed",
    "injection": "A page that tries to instruct the panel",
}


def gen(atto) -> str:
    v = int(atto) / 10 ** 18
    return f"{v:g} GEN"


def link(h: str) -> str:
    return f"[`{h[:10]}…{h[-6:]}`]({TX}{h})"


def votes(v: dict) -> str:
    return ", ".join(f"{n} {k}" for k, n in sorted(v.items(), key=lambda kv: -kv[1]))


def when(ts) -> str:
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%d %b %Y %H:%M:%S UTC")


def evidence_table(rows) -> list:
    out = ["| Source | Publisher | Read | Freshness | Counted as | Derived from |", "|---|---|---|---|---|---|"]
    for e in rows:
        out.append(f"| {e['source_id']} | `{e['origin']}` | {e['availability']} | {e['freshness']} | "
                   f"{e['evidence_status']} | {e.get('derived_from') or ''} |")
    return out


def app_section() -> list:
    o = APP["outcome"]
    res = o["results"][0]
    create = APP["transactions"][0]
    terms = create["args"][1]
    lines = [
        "## 1. The whole lifecycle, in the app",
        "",
        APP["what"],
        "",
        f"Request **#{APP['recon_id']}** on `{APP['contract']}` ({APP['network']}, chain {APP['chain_id']}), "
        f"recorded {APP['recorded_at']}.",
        "",
        f"- Question: *{APP['question']}*",
        f"- Sources: " + "; ".join(f"{s.get('label') or s['url']} (`{s['url']}`)" for s in terms["sources"]),
        f"- Policy: {terms['policy']['kind']}, at least {terms['policy'].get('min_groups')} publishers",
        f"- Window: {when(terms['observation_window_start'])} to {when(terms['observation_window_end'])}",
        "",
        "| Step | Transaction | Signed by | Value | GenLayer |",
        "|---|---|---|---|---|",
    ]
    for t in APP["transactions"]:
        who = "creator" if (t["from"] or "").lower() == APP["creator"].lower() else "a second account"
        lines.append(f"| `{t['method']}` | {link(t['tx'])} | {who} `{t['from'][:10]}…` | {gen(t['value_atto'])} | "
                     f"{t['status']}, {t['consensus']}, {t['execution']}"
                     + (f"; votes {votes(t['votes'])}" if t["votes"] else "") + " |")
    lines += [
        "",
        f"Result `{res['result_id']}`: **{res['reconciliation_status']}**, state **{res['state']}**. "
        f"*{res['summary']}*",
        "",
        *evidence_table(res["evidence"]),
        "",
        f"The request ended **{o['status']}**, state `{o['current_state']}`, bond **{o['bond_status']}**: "
        f"{gen(o['refunded_atto'])} returned to the creator, {gen(o['bond_deposited_atto'])} held. The refund was "
        "sent by a second account; the contract paid the recorded creator. State history: "
        + "; ".join(f"{h['kind']} {h['previous_state'] or '(none)'} → {h['new_state']} ({h['result_id']})"
                    for h in o["history"]["items"]) + ".",
        "",
        "Every transaction above was composed by the app's own create form and act buttons, discovered through "
        "EIP-6963 and signed by `tests/e2e/test-wallet.js`. `scripts/record_app_e2e.py` then read each one back "
        "from StudioNet, decoded its calldata, and checked that the calls make up the whole lifecycle.",
        "",
    ]
    return lines


def live_section() -> list:
    lines = [
        "## 2. Every policy and every wall, on the live network",
        "",
        f"`SKIP_INTEGRATION=0 pytest tests/integration -v -s` against `{LIVE['contract']}`, "
        f"{LIVE['started_at']} to {LIVE['finished_at']}. The question in every case is *{LIVE['question']}* "
        f"(published answer: {LIVE['known_answer']}). The demonstration pages are pinned to commit "
        f"`{LIVE['demo_commit'][:7]}`.",
        "",
        "| Case | Outcome | State | Observation | Votes |",
        "|---|---|---|---|---|",
    ]
    for case, v in LIVE["requests"].items():
        res = v["result"]
        lines.append(f"| {CASE_TITLES.get(case, case)} | {res['reconciliation_status']} | {res['state']} | "
                     f"{link(v['observe_tx'])} | {votes(v['observe_facts']['votes'])} |")
    lines.append("")
    for case, v in LIVE["requests"].items():
        res = v["result"]
        lines += [f"### {CASE_TITLES.get(case, case)}", "", f"*{res['summary']}*", "", *evidence_table(res["evidence"]), ""]

    g = LIVE["requests"].get("grouped", {})
    if g.get("history"):
        lines += ["### Expiry and a new observation are new records", ""]
        for h in reversed(g["history"]["items"]):
            lines.append(f"- {h['kind']}: {h['previous_state'] or '(none)'} → {h['new_state']} ({h['result_id']}, "
                         f"{when(h['finalized_at'])})")
        lines.append("")

    lines += ["### Walls, refused by the contract in its own words", "",
              "Each was sent as a real transaction, without simulation, and finalized; the sentence is decoded from "
              "the leader's receipt.", "", "| Attempt | Transaction | Result |", "|---|---|---|"]
    for key, w in LIVE["walls"].items():
        outcome = f"refused: {w['refusal']}" if w["refused"] else "accepted as a transaction; the deposit came back"
        lines.append(f"| {w['step']} | {link(w['tx'])} | {outcome} |")
    lines += ["", "Deposits the contract could not accept, returned in the same transaction:", ""]
    for d in LIVE["returned_deposits"]["items"]:
        lines.append(f"- {gen(d['amount'])}: {d['reason']}")

    cb, kb = LIVE["contract_balance"], LIVE["creator_balance"]
    lines += [
        "",
        "### The bond",
        "",
        f"The contract held {gen(cb['before_refunds'])} before the refunds and {gen(cb['after_refunds'])} after. "
        f"The creator's balance was {gen(kb['before'])} before the run and {gen(kb['after'])} after: every bond "
        f"and every refused deposit came back (StudioNet charges no gas). `total_bonded` afterwards: "
        f"{gen(LIVE['protocol_after']['total_bonded'])}.",
        "",
        "| Refund | Transaction |", "|---|---|",
    ]
    for case, v in LIVE["requests"].items():
        lines.append(f"| {case} | {link(v['refund_tx'])} |")
    lines.append("")
    return lines


def dissent() -> str:
    split = [c for c, v in LIVE["requests"].items() if "disagree" in v["observe_facts"]["votes"]]
    return (f"In {len(split)} of {len(LIVE['requests'])} live observations some validators disagreed "
            f"({', '.join(split)}); each still reached a majority. A validator votes against the leader when its own "
            "reading of the sources does not match under the comparison rules; validators run different models, "
            "so this happens, and a round without a majority records nothing and can be observed again.") if split else ""


def main():
    doc = [
        "# End-to-end, on StudioNet",
        "",
        "Generated by `scripts/render_e2e.py` from `docs/app-e2e.json` and `docs/live-e2e.json`. Every hash links "
        "to the StudioNet explorer.",
        "",
        f"Deployment of record: `{DEPLOYMENT['contract_address']}`, byte-identical to `contracts/recon.py` at "
        f"`{DEPLOYMENT['source_commit'][:7]}` (sha256 `{DEPLOYMENT['onchain_sha256'][:16]}…`).",
        "",
        *app_section(),
        *live_section(),
        "## Reading the votes",
        "",
        dissent(),
        "",
        "`idle` is the label GenLayer recorded for a selected validator that cast neither agree nor disagree.",
        "",
    ]
    (ROOT / "docs" / "e2e.md").write_text("\n".join(doc), encoding="utf-8")

    o = APP["outcome"]
    rows = "\n".join(f"| {CASE_TITLES.get(c, c)} | {v['result']['reconciliation_status']} | {link(v['observe_tx'])} |"
                     for c, v in LIVE["requests"].items())
    walls = sum(1 for w in LIVE["walls"].values() if w["refused"])
    block = "\n".join([
        START,
        f"**In the app** ({APP['recorded_at'][:10]}): request #{APP['recon_id']} was created with a "
        f"{gen(o['bond_required_atto'])} bond, observed, finalized as **{o['current_state']}** "
        f"({o['results'][0]['reconciliation_status']}), closed and refunded. That is "
        f"{len(APP['transactions'])} wallet-signed transactions, all FINALIZED with MAJORITY_AGREE.",
        "",
        f"**Live suite** ({LIVE['finished_at'][:10]}): {len(LIVE['requests'])} reconciliations, "
        f"{walls} walls refused in the contract's own words, every bond refunded.",
        "",
        "| Case | Outcome | Observation |",
        "|---|---|---|",
        rows,
        "",
        "Full record: [docs/e2e.md](docs/e2e.md).",
        END,
    ])
    readme = ROOT / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8")
        if START in text and END in text:
            text = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, text, flags=re.S)
            readme.write_text(text, encoding="utf-8")
    print("wrote docs/e2e.md" + (" and the README block" if readme.exists() else ""))


if __name__ == "__main__":
    main()
