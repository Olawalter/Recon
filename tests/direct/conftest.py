"""Shared fixtures for the RECON direct suite.

Direct mode (the official `genlayer-test` runner) executes the contract in a
real GenVM Python runner. Transaction time comes from `direct_vm.warp()`, the
web from `direct_vm.mock_web`, and the model from `direct_vm.mock_llm`. These
are official test mechanisms and exist only here: they prove what the CONTRACT
decides from a given retrieval and a given reading. Whether real validators
read real pages the same way is the integration suite's job.

A model mock reports what each source states, never a reconciled state: the
contract accepts no state from the model.
"""
import datetime
import json
import os
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
# RECON_CONTRACT points the suite at another copy (used by the mutation sweep).
CONTRACT = pathlib.Path(os.environ.get("RECON_CONTRACT") or ROOT / "contracts" / "recon.py")

GEN = 10 ** 18
BOND = 10 ** 16                          # 0.01 GEN
MINUTE = 60
HOUR = 3600
DAY = 86400
T0 = 1_790_035_200                       # 2026-09-22T00:00:00Z: every suite starts here
OBSERVE = T0 + HOUR
FINALITY_DELAY = 300
INTERVAL = 900

QUESTION = "Are Northwind's customer services operational right now?"

URL_OFFICIAL = "https://status.northwind.test/api/summary"
URL_MONITOR = "https://monitor.watchtower.test/northwind"
URL_NEWS = "https://news.dailyledger.test/northwind-outage"
URL_MIRROR = "https://aggregator.feedhub.test/northwind"
URL_OFFICIAL_BLOG = "https://blog.northwind.test/incidents"

SOURCES = [
    {"url": URL_OFFICIAL, "label": "Northwind status page", "declared_class": "OFFICIAL"},
    {"url": URL_MONITOR, "label": "Watchtower uptime monitor", "declared_class": "INDEPENDENT"},
    {"url": URL_NEWS, "label": "Daily Ledger report", "declared_class": "INDEPENDENT"},
]
CATEGORICAL = {"kind": "CATEGORICAL", "values": ["OPERATIONAL", "DEGRADED", "OFFLINE"]}
MAJORITY = {"kind": "MAJORITY", "min_groups": 2, "stale_contributes": False}


def page(text: str) -> bytes:
    return f"<!doctype html><html><body><main>{text}</main><script>track()</script></body></html>".encode()


Q_OFFICIAL = "All Northwind customer services are operational."
Q_MONITOR = "Northwind services are responding normally and are fully operational."
Q_NEWS_OK = "Northwind confirmed its customer services are operational again."
Q_NEWS_DOWN = "Northwind's customer services have been offline since this morning."
D_OFFICIAL = "Last updated 2026-09-22 00:40 UTC"
D_MONITOR = "Checked 22 September 2026"

BODY_OFFICIAL = page(f"<h1>Northwind status</h1><p>{Q_OFFICIAL}</p><p>{D_OFFICIAL}</p>")
BODY_MONITOR = page(f"<h1>Watchtower</h1><p>{Q_MONITOR}</p><p>{D_MONITOR}</p>")
BODY_NEWS_OK = page(f"<h1>Daily Ledger</h1><p>{Q_NEWS_OK}</p>")
BODY_NEWS_DOWN = page(f"<h1>Daily Ledger</h1><p>{Q_NEWS_DOWN}</p>")

WEB_AGREE = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_OK)}


# ─── time ────────────────────────────────────────────────────────────────────

def iso(unix_seconds: int) -> str:
    return datetime.datetime.fromtimestamp(
        int(unix_seconds), tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def warp_to(direct_vm, unix_seconds: int) -> None:
    direct_vm.warp(iso(unix_seconds))


# ─── what a model reader reports ─────────────────────────────────────────────

def src(sid, claim="NONE", quote="", as_of="", as_of_quote="", derived_from="", derived_quote=""):
    return {"source_id": sid, "claim": claim, "quote": quote, "as_of": as_of, "as_of_quote": as_of_quote,
            "derived_from": derived_from, "derived_quote": derived_quote}


def answer(*items) -> str:
    return json.dumps({"note": "each source read on its own", "sources": list(items)})


READ_AGREE = answer(
    src("E1", "OPERATIONAL", Q_OFFICIAL, "2026-09-22", D_OFFICIAL),
    src("E2", "OPERATIONAL", Q_MONITOR, "2026-09-22", D_MONITOR),
    src("E3", "OPERATIONAL", Q_NEWS_OK),
)


def mock_round(direct_vm, llm_json=READ_AGREE, web=None, headers=None) -> None:
    """Register what the sources serve and what a model reader reports. Mocks
    are first-registered-wins, so clear first."""
    direct_vm.clear_mocks()
    for url, (status, body) in (web if web is not None else WEB_AGREE).items():
        hdrs = (headers or {}).get(url, {})
        direct_vm.mock_web("^" + re.escape(url) + "$",
                           {"response": {"status": status, "headers": hdrs, "body": body}})
    if llm_json is not None:
        direct_vm.mock_llm(r".*RECON panel.*", llm_json)


def record_prompts(direct_vm) -> list:
    seen = []
    original = direct_vm._match_llm_mock

    def recording(prompt):
        seen.append(prompt)
        return original(prompt)

    direct_vm._match_llm_mock = recording
    return seen


def round_index(direct_vm) -> int:
    captured = direct_vm._captured_validators
    for i in range(len(captured) - 1, -1, -1):
        result = captured[i][0]
        if isinstance(result, dict) and "reconciliation_status" in result:
            return i
    raise AssertionError("no reconciliation round captured")


def hex_of(account) -> str:
    raw = account.as_bytes if hasattr(account, "as_bytes") else bytes(account)
    return "0x" + raw.hex()


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def transfers(monkeypatch):
    """Every GEN transfer the contract emits, as (recipient_hex, atto)."""
    from gltest.direct import wasi_mock
    sent = []
    original = wasi_mock._handle_gl_call

    def recording(vm, request):
        if isinstance(request, dict) and "EthSend" in request:
            op = request["EthSend"]
            addr = op["address"]
            raw = addr.as_bytes if hasattr(addr, "as_bytes") else bytes(addr)
            sent.append(("0x" + raw.hex(), int(op["value"])))
        return original(vm, request)

    monkeypatch.setattr(wasi_mock, "_handle_gl_call", recording)
    return sent


@pytest.fixture
def contract_path():
    return str(CONTRACT)


@pytest.fixture
def deployed(direct_vm, direct_deploy, contract_path):
    warp_to(direct_vm, T0)
    return direct_deploy(contract_path)


def terms(sources=None, result_type=None, policy=None, start=T0, end=T0 + 2 * DAY, freshness=0,
          validity=6 * HOUR, **extra) -> str:
    t = {"sources": sources if sources is not None else SOURCES,
         "result_type": result_type if result_type is not None else CATEGORICAL,
         "policy": policy if policy is not None else MAJORITY,
         "observation_window_start": start, "observation_window_end": end,
         "freshness_requirement": freshness, "validity_seconds": validity}
    t.update(extra)
    return json.dumps(t)


def create(deployed, direct_vm, creator, question=QUESTION, bond=BOND, value=None, **terms_over) -> str:
    direct_vm.sender = creator
    direct_vm.value = bond if value is None else value
    try:
        return deployed.create_recon(question, terms(**terms_over), bond)
    finally:
        direct_vm.value = 0


def observe(direct_vm, deployed, sender, rid, at=OBSERVE, llm_json=READ_AGREE, web=None, headers=None) -> str:
    warp_to(direct_vm, at)
    mock_round(direct_vm, llm_json, web, headers)
    direct_vm.sender = sender
    return deployed.observe_recon(rid)


def finalize(direct_vm, deployed, sender, rid, at=None):
    rec = deployed.get_result(deployed.get_recon(rid)["latest_result_id"])
    warp_to(direct_vm, at if at is not None else int(rec["proposed_at"]) + FINALITY_DELAY)
    direct_vm.sender = sender
    deployed.finalize_result(rid)


def latest(deployed, rid) -> dict:
    return deployed.get_result(deployed.get_recon(rid)["latest_result_id"])


def by_source(result: dict) -> dict:
    return {e["source_id"]: e for e in result["evidence"]}


@pytest.fixture
def created(direct_vm, deployed, direct_alice):
    """A bonded request: Alice is the creator."""
    return create(deployed, direct_vm, direct_alice)


@pytest.fixture
def proposed(direct_vm, deployed, direct_bob, created):
    """Observed once, by someone other than the creator; every source agrees."""
    observe(direct_vm, deployed, direct_bob, created)
    return created


@pytest.fixture
def finalized(direct_vm, deployed, direct_charlie, proposed):
    finalize(direct_vm, deployed, direct_charlie, proposed)
    return proposed
