"""Live integration harness: GenLayer StudioNet, real validators, real pages,
real GEN.

    SKIP_INTEGRATION=0 python -m pytest tests/integration -v -s
    (the gltest wrapper collects the same tests:
     SKIP_INTEGRATION=0 gltest tests/integration -v -s)

No keys are needed: the harness creates throwaway creator and observer
accounts and funds them from the StudioNet faucet. It deploys
contracts/recon.py from the working tree (or reuses RECON_CONTRACT) and drives
seven requests about one public fact whose answer is known: Python 3.12.0 was
released on 2023-10-02. The official release page, the release schedule (PEP
693, the same publisher) and endoflife.date state it independently; three
clearly labelled demonstration pages in this repository supply a conflicting
source, a derived source and a prompt-injection attempt.

  grouped      python.org twice, endoflife.date, and a page that does not exist:
               two pages of one publisher are one voice; a missing page is not
               a contradiction
  majority     python.org, endoflife.date, the conflicting page, under MAJORITY
  strict       the same three sources, under STRICT
  derived      python.org, endoflife.date, a page that cites endoflife.date,
               under STRICT needing three independent voices
  stale        python.org and endoflife.date with a 30-day freshness requirement
  authority    python.org declared OFFICIAL, confirmed by endoflife.date
  injection    python.org, endoflife.date, a page that tries to instruct the panel

Phases run lazily, in order, exactly once; a failed phase fails every test that
needs it without re-running. Every transaction (hash, status, consensus result,
execution result and the contract's own refusal sentence) is written to
docs/live-e2e.json.
"""
import base64
import json
import os
import pathlib
import time
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "recon.py"
RECORD = ROOT / "docs" / "live-e2e.json"
RPC = "https://studio.genlayer.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
LIVE = os.environ.get("SKIP_INTEGRATION", "1") == "0"

BOND = 10 ** 16                  # 0.01 GEN
FINALITY_DELAY = 300
INTERVAL = 900
WINDOW = 32 * 60                 # every live request is observable for 32 minutes
VALIDITY = 120                   # short, so expiry can be proven live
ANSWER = "2023-10-02"
QUESTION = "On what date was Python 3.12.0 released?"

# The demonstration pages are pinned to the commit that published them: a
# branch URL is cached and could change; a commit's bytes cannot.
DEMO_COMMIT = os.environ.get("RECON_DEMO_COMMIT", "")
DEMO = f"https://raw.githubusercontent.com/Olawalter/Recon/{DEMO_COMMIT}/demo"

PY_RELEASE = {"url": "https://www.python.org/downloads/release/python-3120/",
              "label": "python.org release page", "declared_class": "OFFICIAL"}
PY_SCHEDULE = {"url": "https://peps.python.org/pep-0693/", "label": "PEP 693 release schedule",
               "declared_class": "OFFICIAL"}
PY_MISSING = {"url": "https://www.python.org/downloads/release/python-3990/",
              "label": "a release page that does not exist", "declared_class": "UNKNOWN"}
EOL = {"url": "https://endoflife.date/api/python.json", "label": "endoflife.date", "declared_class": "INDEPENDENT"}
CONFLICTING = {"url": f"{DEMO}/conflicting-report.md", "label": "RECON demonstration: conflicting digest",
               "declared_class": "UNKNOWN"}
DERIVED = {"url": f"{DEMO}/derived-report.md", "label": "RECON demonstration: derived digest",
           "declared_class": "UNKNOWN"}
INJECTION = {"url": f"{DEMO}/injection-report.md", "label": "RECON demonstration: injection attempt",
             "declared_class": "UNKNOWN"}

TEMPORAL = {"kind": "TEMPORAL"}
MAJORITY = {"kind": "MAJORITY", "min_groups": 2, "stale_contributes": False}

CASES = {
    "grouped": {"sources": [PY_RELEASE, PY_SCHEDULE, EOL, PY_MISSING], "policy": MAJORITY, "freshness": 0},
    "majority": {"sources": [PY_RELEASE, EOL, CONFLICTING], "policy": MAJORITY, "freshness": 0},
    "strict": {"sources": [PY_RELEASE, EOL, CONFLICTING], "policy": {"kind": "STRICT", "min_groups": 2},
               "freshness": 0},
    "derived": {"sources": [PY_RELEASE, EOL, DERIVED], "policy": {"kind": "STRICT", "min_groups": 3},
                "freshness": 0},
    "stale": {"sources": [PY_RELEASE, EOL], "policy": MAJORITY, "freshness": 30 * 86400},
    "authority": {"sources": [PY_RELEASE, EOL],
                  "policy": {"kind": "AUTHORITY_CONFIRMATION", "min_confirmations": 1}, "freshness": 0},
    "injection": {"sources": [PY_RELEASE, EOL, INJECTION], "policy": MAJORITY, "freshness": 0},
}


def rpc(method, params, attempts=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(attempts):
        try:
            req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json",
                                                                  "User-Agent": UA})
            out = json.load(urllib.request.urlopen(req, timeout=120))
            if "error" in out:
                err = out["error"]
                if "temporarily unavailable" in str(err).lower() or "-32002" in str(err):
                    raise ConnectionError(f"{method}: {err}")       # overload: retried below
                raise RuntimeError(f"{method}: {err}")
            return out["result"]
        except RuntimeError:
            raise
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(5 + 5 * i)


def _patch_transport():
    """The public RPC drops connections and serves CDN error pages mid-poll.
    Retry transport failures only; a JSON-RPC error is a real answer."""
    from genlayer_py.provider.provider import GenLayerProvider
    original = GenLayerProvider.make_request

    def make_request(self, method, params):
        for i in range(8):
            try:
                return original(self, method, params)
            except Exception as e:
                text = str(e)
                transient = any(s in text for s in (
                    "Connection", "timed out", "SSL", "502", "503", "504", "429",
                    "<!DOCTYPE", "invalid JSON", "RemoteDisconnected", "reset",
                    # StudioNet answers overload as a JSON-RPC error, not an HTTP one
                    "temporarily unavailable", "-32002"))
                if not transient or i == 7:
                    raise
                time.sleep(5 + 5 * i)
    GenLayerProvider.make_request = make_request


def _hex(tx):
    return tx.hex() if hasattr(tx, "hex") else str(tx)


def _utc():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _decode_payload(result):
    """A refusal's text: the leader result is base64 with a leading code byte."""
    payload = result.get("payload") if isinstance(result, dict) else result
    if isinstance(payload, str):
        try:
            raw = base64.b64decode(payload, validate=True)
            return raw[1:].decode("utf-8", "replace") if raw else ""
        except Exception:
            return payload
    return str(payload or "")


class Live:
    def __init__(self):
        from eth_account import Account
        from genlayer_py import create_client
        from genlayer_py.chains import studionet
        if not DEMO_COMMIT:
            raise RuntimeError("set RECON_DEMO_COMMIT to the commit that published demo/")
        _patch_transport()
        self._create_client, self._chain = create_client, studionet
        self.creator = Account.create()
        self.observer = Account.create()        # a party to nothing: observes, finalizes, closes, refunds
        self.reader = create_client(chain=studionet, account=Account.create())
        self.record = {"network": "GenLayer StudioNet", "chain_id": studionet.id, "rpc": RPC,
                       "finality_window_seconds": rpc("sim_getFinalityWindowTime", []),
                       "contract_finality_delay_seconds": FINALITY_DELAY, "question": QUESTION,
                       "known_answer": ANSWER, "demo_commit": DEMO_COMMIT,
                       "accounts": {"creator": self.creator.address, "observer": self.observer.address},
                       "started_at": _utc(), "transactions": [], "requests": {}}
        for acct in (self.creator, self.observer):
            rpc("sim_fundAccount", [acct.address, 10 ** 18])
        for acct in (self.creator, self.observer):
            self.await_(lambda a=acct: self.balance(a.address) > 0, "faucet")

        existing = os.environ.get("RECON_CONTRACT")
        if existing:
            self.address = existing
            self.record["deployment"] = {"address": existing, "reused": True}
        else:
            self.address, self.record["deployment"] = self._deploy()
        self.await_(lambda: self.read("get_protocol_info") is not None, "deployment")
        self.record["contract"] = self.address
        self.record["protocol"] = self.read("get_protocol_info")

    def _deploy(self):
        code = CONTRACT.read_bytes().replace(b"\r\n", b"\n")
        c = self.client(self.creator)
        tx = c.deploy_contract(code=code)
        receipt = self.wait(c, tx, "ACCEPTED")
        address = (receipt.get("data") or {}).get("contract_address")
        return address, {"address": address, "tx": _hex(tx), "consensus": receipt.get("result_name")}

    # ── plumbing ──
    def client(self, acct):
        return self._create_client(chain=self._chain, account=acct)

    def wait(self, c, tx, status):
        from genlayer_py.types import TransactionStatus
        return c.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus[status],
                                              interval=5000, retries=360)

    @staticmethod
    def await_(predicate, what, tries=60, pause=5):
        for _ in range(tries):
            try:
                if predicate():
                    return
            except Exception:
                pass
            time.sleep(pause)
        raise TimeoutError(f"timed out waiting for {what}")

    def balance(self, address) -> int:
        return int(self.reader.get_balance(address))

    def read(self, fn, *args):
        return self.reader.read_contract(address=self.address, function_name=fn, args=list(args))

    def tx_facts(self, tx_hash) -> dict:
        t = rpc("eth_getTransactionByHash", [tx_hash]) or {}
        votes = list(((t.get("consensus_data") or {}).get("votes") or {}).values())
        return {"status": t.get("status"), "consensus": t.get("result_name"),
                "votes": {v: votes.count(v) for v in sorted(set(votes))}}

    def write(self, acct, fn, *args, value=0, step=None, request=None):
        c = self.client(acct)
        tx = c.write_contract(address=self.address, function_name=fn, args=list(args), value=value)
        receipt = self.wait(c, tx, "ACCEPTED")
        leader = ((receipt.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        result = leader.get("result") or {}
        entry = {"step": step or fn, "request": request, "function": fn,
                 "caller": "creator" if acct is self.creator else "observer",
                 "tx": _hex(tx), "value": value, "status": receipt.get("status_name"),
                 "consensus": receipt.get("result_name"), "execution": leader.get("execution_result"),
                 "refused": leader.get("execution_result") not in (None, "SUCCESS")}
        if entry["refused"]:
            entry["refusal"] = _decode_payload(result)
        self.record["transactions"].append(entry)
        print(f"  {entry['step']:<52} {entry['tx'][:18]}…  {entry['status']} {entry['consensus']}  "
              f"{entry['execution']}" + (f"  REFUSED: {entry['refusal'][:100]}" if entry["refused"] else ""))
        return entry

    @staticmethod
    def sleep_until(unix_seconds, margin=20, why=""):
        remaining = int(unix_seconds) + margin - time.time()
        if remaining > 0:
            print(f"  … waiting {int(remaining)}s of real time {why}")
            time.sleep(remaining)

    def save(self):
        self.record["finished_at"] = _utc()
        RECORD.parent.mkdir(parents=True, exist_ok=True)
        RECORD.write_text(json.dumps(self.record, indent=2, default=str) + "\n", encoding="utf-8")


def terms_for(case, start, end):
    spec = CASES[case]
    return json.dumps({"sources": spec["sources"], "result_type": TEMPORAL, "policy": spec["policy"],
                       "observation_window_start": start, "observation_window_end": end,
                       "freshness_requirement": spec["freshness"], "validity_seconds": VALIDITY})


class World:
    """The live lifecycle, advanced on demand, each phase exactly once."""

    def __init__(self, live: Live):
        self.live = live
        self.done, self.failed = set(), {}
        self.ids = {}
        self.window_end = 0
        self.balance_before = 0

    def _once(self, name, fn):
        if name in self.failed:
            raise RuntimeError(f"phase {name} already failed: {self.failed[name]}")
        if name not in self.done:
            print(f"\nPHASE {name}")
            try:
                fn()
            except Exception as e:
                self.failed[name] = f"{type(e).__name__}: {str(e)[:300]}"
                self.live.record.setdefault("failed_phases", {})[name] = self.failed[name]
                raise
            finally:
                self.live.save()
            self.done.add(name)

    def request(self, case):
        return self.live.read("get_recon", self.ids[case])

    def result(self, case, index=-1):
        items = self.live.read("get_results", self.ids[case], 0, 50)["items"]   # newest first
        return list(reversed(items))[index]

    # ── create ──
    def created(self):
        def run():
            live = self.live
            now = int(time.time())
            start, self.window_end = now, now + WINDOW
            live.record["window"] = {"start": start, "end": self.window_end}
            self.balance_before = live.balance(live.creator.address)

            # walls at creation: each refused, and any value attached comes straight back
            live.record["walls"] = {
                "zero_bond": live.write(live.creator, "create_recon", QUESTION, terms_for("majority", start, self.window_end),
                                        BOND, value=0, step="create with no bond (refused)"),
                "inexact_bond": live.write(live.creator, "create_recon", QUESTION,
                                           terms_for("majority", start, self.window_end), BOND, value=BOND - 1,
                                           step="create with a bond 1 atto short (returned)"),
                "too_few_origins": live.write(
                    live.creator, "create_recon", QUESTION,
                    json.dumps({**json.loads(terms_for("grouped", start, self.window_end)),
                                "policy": {"kind": "MAJORITY", "min_groups": 3}}),
                    BOND, value=BOND, step="create needing 3 origins from 2 (returned)"),
            }
            live.record["returned_deposits"] = live.read("returned_for", live.creator.address, 0, 10)

            for case in CASES:
                before = live.read("get_protocol_info")["recon_count"]
                live.write(live.creator, "create_recon", QUESTION, terms_for(case, start, self.window_end), BOND,
                           value=BOND, step=f"create_recon [{case}]", request=case)
                rid = str(before + 1)
                r = live.read("get_recon", rid)
                assert r["question"] == QUESTION and r["bond_deposited"] == str(BOND), r
                self.ids[case] = rid
                live.record["requests"][case] = {"recon_id": rid, "created": r}

            # a request that has not been observed: cancelled by its creator only
            later = live.read("get_protocol_info")["recon_count"] + 1
            live.write(live.creator, "create_recon", QUESTION,
                       terms_for("majority", start + 3600, start + 7200), BOND, value=BOND,
                       step="create_recon [cancel] (window opens in an hour)", request="cancel")
            self.ids["cancel"] = str(later)
            live.record["walls"]["observe_before_window"] = live.write(
                live.observer, "observe_recon", self.ids["cancel"], step="observe before the window (refused)",
                request="cancel")
            live.record["walls"]["cancel_by_stranger"] = live.write(
                live.observer, "cancel_recon", self.ids["cancel"], step="cancel by someone else (refused)",
                request="cancel")
            live.record["walls"]["refund_while_locked"] = live.write(
                live.observer, "refund_bond", self.ids["majority"], step="refund a locked bond (refused)",
                request="majority")
            live.write(live.creator, "cancel_recon", self.ids["cancel"], step="cancel_recon by the creator",
                       request="cancel")
            live.write(live.observer, "refund_bond", self.ids["cancel"], step="refund_bond [cancel]",
                       request="cancel")
        self._once("create", run)
        return self.ids

    # ── observe ──
    def observed(self):
        self.created()

        def run():
            live = self.live
            for case in CASES:
                entry = live.write(live.observer, "observe_recon", self.ids[case],
                                   step=f"observe_recon [{case}]", request=case)
                assert not entry["refused"], entry
                live.record["requests"][case]["observe_tx"] = entry["tx"]
                live.record["requests"][case]["observe_facts"] = live.tx_facts(entry["tx"])
                res = self.result(case)
                live.record["requests"][case]["result"] = res
                print(f"    -> {res['state']} {res['reconciliation_status']}: {res['summary']}")
            live.record["walls"]["observe_while_pending"] = live.write(
                live.observer, "observe_recon", self.ids["majority"], step="observe while a result is pending (refused)",
                request="majority")
            live.record["walls"]["finalize_early"] = live.write(
                live.observer, "finalize_result", self.ids["majority"], step="finalize before the delay (refused)",
                request="majority")
        self._once("observe", run)
        return self.ids

    # ── finalize ──
    def finalized(self):
        self.observed()

        def run():
            live = self.live
            latest = max(int(self.result(c)["proposed_at"]) for c in CASES)
            live.sleep_until(latest + FINALITY_DELAY, why="for the contract's finality delay")
            for case in CASES:
                live.write(live.observer, "finalize_result", self.ids[case], step=f"finalize_result [{case}]",
                           request=case)
                tx = live.record["requests"][case]["observe_tx"]
                live.await_(lambda t=tx: live.tx_facts(t)["status"] == "FINALIZED",
                            f"protocol finality of {tx[:10]}", tries=120, pause=10)
                live.record["requests"][case]["observe_final"] = live.tx_facts(tx)
                live.record["requests"][case]["after_finality"] = self.request(case)
        self._once("finalize", run)
        return self.ids

    # ── expire and observe again ──
    def reobserved(self):
        self.finalized()

        def run():
            live = self.live
            g = self.ids["grouped"]
            first = self.result("grouped")
            live.sleep_until(int(first["valid_until"]), why="for the first result's validity to pass")
            live.write(live.observer, "expire_result", g, step="expire_result [grouped]", request="grouped")
            live.record["requests"]["grouped"]["after_expiry"] = self.request("grouped")
            live.sleep_until(int(first["proposed_at"]) + INTERVAL, why="for the observation interval")
            entry = live.write(live.observer, "observe_recon", g, step="observe_recon again [grouped]", request="grouped")
            live.record["requests"]["grouped"]["observe_again_tx"] = entry["tx"]
            live.sleep_until(int(self.result("grouped")["proposed_at"]) + FINALITY_DELAY, why="for finality")
            live.write(live.observer, "finalize_result", g, step="finalize_result again [grouped]", request="grouped")
            live.record["requests"]["grouped"]["second_result"] = self.result("grouped")
            live.record["requests"]["grouped"]["history"] = live.read("get_history", g, 0, 20)
        self._once("reobserve", run)
        return self.ids

    # ── close and refund ──
    def refunded(self):
        self.reobserved()

        def run():
            live = self.live
            live.record["walls"]["close_while_open"] = live.write(
                live.observer, "close_recon", self.ids["majority"], step="close while the window is open (refused)",
                request="majority")
            live.sleep_until(self.window_end, why="for the observation window to end")
            held_before = live.balance(live.address)
            for case in CASES:
                live.write(live.observer, "close_recon", self.ids[case], step=f"close_recon [{case}]", request=case)
                entry = live.write(live.observer, "refund_bond", self.ids[case], step=f"refund_bond [{case}]",
                                   request=case)
                live.record["requests"][case]["refund_tx"] = entry["tx"]
                live.record["requests"][case]["closed"] = self.request(case)
            live.record["walls"]["refund_twice"] = live.write(
                live.observer, "refund_bond", self.ids["majority"], step="refund a second time (refused)",
                request="majority")
            for case in CASES:
                tx = live.record["requests"][case]["refund_tx"]
                live.await_(lambda t=tx: live.tx_facts(t)["status"] == "FINALIZED",
                            f"refund finality {tx[:10]}", tries=120, pause=10)
            live.record["contract_balance"] = {"before_refunds": str(held_before),
                                               "after_refunds": str(live.balance(live.address))}
            live.record["creator_balance"] = {"before": str(self.balance_before),
                                              "after": str(live.balance(live.creator.address))}
            live.record["protocol_after"] = live.read("get_protocol_info")
        self._once("refund", run)
        return self.ids


@pytest.fixture(scope="session")
def world():
    if not LIVE:
        pytest.skip("live StudioNet suite; set SKIP_INTEGRATION=0 to run it (about 45 minutes)")
    live = Live()
    w = World(live)
    yield w
    live.save()
