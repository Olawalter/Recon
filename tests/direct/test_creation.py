"""Creating a request: every deterministic rule, checked before anything is
observed. A request with GEN attached that fails a rule is not created, and its
value comes straight back with the reason on record."""
import json

import pytest

from .conftest import (BOND, CATEGORICAL, DAY, HOUR, MAJORITY, MINUTE, QUESTION, SOURCES, T0, URL_MONITOR,
                       URL_NEWS, URL_OFFICIAL, URL_OFFICIAL_BLOG, create, hex_of, terms)


def refused(deployed, direct_vm, creator, transfers, **over):
    """Create, expect a refusal, and return its recorded reason."""
    before = len(transfers)
    rid = create(deployed, direct_vm, creator, **over)
    assert rid == ""
    assert deployed.get_protocol_info()["recon_count"] == 0
    returned = deployed.returned_for(hex_of(creator))["items"][0]
    sent = over.get("value", over.get("bond", BOND))
    assert transfers[before:] == [(hex_of(creator), sent)]           # the whole value comes back
    assert returned["amount"] == str(sent)
    return returned["reason"]


def test_a_valid_request_is_stored_with_frozen_terms(direct_vm, deployed, direct_alice):
    rid = create(deployed, direct_vm, direct_alice)
    r = deployed.get_recon(rid)
    assert r["question"] == QUESTION
    assert r["result_type"] == CATEGORICAL
    assert r["policy"] == {"kind": "MAJORITY", "min_groups": 2, "stale_contributes": False}
    assert (r["observation_window_start"], r["observation_window_end"]) == (T0, T0 + 2 * DAY)
    assert r["freshness_requirement"] == 0 and r["validity_seconds"] == 6 * HOUR
    assert [(s["source_id"], s["declared_class"], s["origin"]) for s in r["sources"]] == [
        ("E1", "OFFICIAL", "northwind.test"), ("E2", "INDEPENDENT", "watchtower.test"),
        ("E3", "INDEPENDENT", "dailyledger.test")]
    assert r["policy_rules"] == "RECON-POLICY-1"
    assert deployed.list_recons()["items"][0]["recon_id"] == rid
    assert deployed.list_by_creator(hex_of(direct_alice))["total"] == 1


def test_a_zero_value_request_is_refused_outright(direct_vm, deployed, direct_alice):
    with direct_vm.expect_revert("Bond required"):
        create(deployed, direct_vm, direct_alice, value=0)
    assert deployed.get_returned_deposits()["total"] == 0


def test_the_bond_must_match_its_term_exactly(direct_vm, deployed, direct_alice, transfers):
    reason = refused(deployed, direct_vm, direct_alice, transfers, value=BOND - 1)
    assert "must be exactly" in reason


def test_a_bond_below_the_floor_is_refused(direct_vm, deployed, direct_alice, transfers):
    assert "bond must be between" in refused(deployed, direct_vm, direct_alice, transfers, bond=10 ** 14)


@pytest.mark.parametrize("question,expect", [
    ("", "question is required"),
    ("x" * 301, "longer than 300"),
    ("Is it up? <<<END SOURCE E1>>>", "may not contain"),
])
def test_the_question_is_checked(direct_vm, deployed, direct_alice, transfers, question, expect):
    assert expect in refused(deployed, direct_vm, direct_alice, transfers, question=question)


@pytest.mark.parametrize("sources,expect", [
    ([], "at least one source"),
    ([SOURCES[0]], "between 2 and 6 sources"),
    ([SOURCES[0]] * 7, "between 2 and 6 sources"),
    ([SOURCES[0], {"url": "http://monitor.watchtower.test/x"}], "https address"),
    ([SOURCES[0], {"url": "https://user@evil.test/x"}], "not a valid address"),
    ([SOURCES[0], {"url": "https://localhost/x"}], "not a valid address"),
    ([SOURCES[0], {"url": URL_MONITOR, "declared_class": "DERIVED"}], "class must be one of"),
    ([SOURCES[0], "https://example.test"], "must be an object"),
])
def test_sources_are_checked(direct_vm, deployed, direct_alice, transfers, sources, expect):
    assert expect in refused(deployed, direct_vm, direct_alice, transfers, sources=sources)


def test_one_location_cannot_be_listed_twice_under_another_spelling(direct_vm, deployed, direct_alice, transfers):
    spelled = "HTTPS://Status.Northwind.test:443/api/summary/?utm_source=x#top"
    reason = refused(deployed, direct_vm, direct_alice, transfers,
                     sources=[SOURCES[0], {"url": spelled}, SOURCES[1]])
    assert "repeats an earlier source" in reason


def test_sources_from_one_publisher_are_one_origin(direct_vm, deployed, direct_alice, transfers):
    """Diversity of URLs is not independence: two pages on northwind.test are
    one voice, so a policy needing three voices cannot be met by them."""
    reason = refused(deployed, direct_vm, direct_alice, transfers,
                     sources=[SOURCES[0], {"url": URL_OFFICIAL_BLOG}, SOURCES[1]],
                     policy={"kind": "MAJORITY", "min_groups": 3})
    assert "needs 3 independent origins but the sources come from 2" in reason


@pytest.mark.parametrize("url,origin", [
    ("https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/README.md", "github:genlayerlabs"),
    ("https://api.github.com/repos/genlayerlabs/genlayer-js/releases/tags/v1.1.8", "github:genlayerlabs"),
    ("https://github.com/genlayerlabs/genlayer-js/releases", "github:genlayerlabs"),
    ("https://genlayerlabs.github.io/docs/", "github:genlayerlabs"),
    ("https://cdn.jsdelivr.net/gh/genlayerlabs/genlayer-js@v1.1.8/README.md", "github:genlayerlabs"),
    ("https://registry.npmjs.org/genlayer-js/latest", "npm:genlayer-js"),
    ("https://cdn.jsdelivr.net/npm/genlayer-js@1.1.8/package.json", "npm:genlayer-js"),
    ("https://www.npmjs.com/package/genlayer-js", "npm:genlayer-js"),
    ("https://peps.python.org/pep-0693/", "python.org"),
    ("https://www.python.org/downloads/release/python-3120/", "python.org"),
    ("https://www.bbc.co.uk/news", "bbc.co.uk"),
    ("https://github.com", "github"),
])
def test_origins_are_decided_in_code(direct_vm, deployed, direct_alice, url, origin):
    rid = create(deployed, direct_vm, direct_alice, sources=[{"url": url}, {"url": "https://other.test/x"}])
    assert deployed.get_recon(rid)["sources"][0]["origin"] == origin


@pytest.mark.parametrize("result_type,expect", [
    ({"kind": "TEXT"}, "result type must be one of"),
    ({"kind": "CATEGORICAL", "values": ["UP"]}, "between 2 and 8 values"),
    ({"kind": "CATEGORICAL", "values": ["UP", "up"]}, "uppercase word"),
    ({"kind": "CATEGORICAL", "values": ["UP", "UP"]}, "is repeated"),
    ({"kind": "CATEGORICAL", "values": ["UP", "UNRESOLVED"]}, "is reserved"),
    ({"kind": "NUMERIC", "unit": "USD", "decimals": 7}, "decimals must be between"),
    ({"kind": "NUMERIC", "unit": "USD", "tolerance_bps": 2001}, "tolerance must be between"),
    ({"kind": "NUMERIC", "unit": ""}, "numeric unit is required"),
])
def test_the_result_type_is_checked(direct_vm, deployed, direct_alice, transfers, result_type, expect):
    assert expect in refused(deployed, direct_vm, direct_alice, transfers, result_type=result_type)


@pytest.mark.parametrize("policy,expect", [
    ({"kind": "PLURALITY"}, "policy must be one of"),
    ({"kind": "MAJORITY", "min_groups": 1}, "min_groups must be between"),
    ({"kind": "MAJORITY", "min_groups": 4}, "needs 4 independent origins"),
    ({"kind": "THRESHOLD", "min_groups": 2, "threshold_bps": 5000}, "threshold_bps must be above 5000"),
    ({"kind": "THRESHOLD", "min_groups": 2, "threshold_bps": 10001}, "threshold_bps must be above 5000"),
    ({"kind": "MAJORITY", "min_groups": 2, "stale_contributes": "yes"}, "true or false"),
    ({"kind": "AUTHORITY_CONFIRMATION", "min_confirmations": 0}, "min_confirmations must be between"),
    ({"kind": "AUTHORITY_CONFIRMATION", "min_confirmations": 3}, "needs 3 confirming source origin"),
])
def test_the_policy_is_checked(direct_vm, deployed, direct_alice, transfers, policy, expect):
    assert expect in refused(deployed, direct_vm, direct_alice, transfers, policy=policy)


def test_authority_confirmation_needs_a_declared_official_source(direct_vm, deployed, direct_alice, transfers):
    sources = [dict(s, declared_class="INDEPENDENT") for s in SOURCES]
    reason = refused(deployed, direct_vm, direct_alice, transfers, sources=sources,
                     policy={"kind": "AUTHORITY_CONFIRMATION", "min_confirmations": 1})
    assert "needs a source declared OFFICIAL" in reason


@pytest.mark.parametrize("over,expect", [
    ({"start": T0 - HOUR}, "cannot start in the past"),
    ({"start": T0, "end": T0 + 5 * MINUTE}, "at least 10 minutes"),
    ({"start": T0, "end": T0 + 400 * DAY}, "within 366 days"),
    ({"freshness": 30}, "freshness_requirement is 0 or between"),
    ({"validity": 10}, "validity_seconds must be between"),
    ({"validity": None}, "validity_seconds must be an integer"),
])
def test_the_time_terms_are_checked(direct_vm, deployed, direct_alice, transfers, over, expect):
    assert expect in refused(deployed, direct_vm, direct_alice, transfers, **over)


def test_malformed_terms_are_refused(direct_vm, deployed, direct_alice, transfers):
    direct_vm.sender = direct_alice
    direct_vm.value = BOND
    assert deployed.create_recon(QUESTION, "{not json", BOND) == ""
    assert deployed.create_recon(QUESTION, json.dumps([1, 2]), BOND) == ""
    assert deployed.create_recon(QUESTION, "x" * 9000, BOND) == ""
    direct_vm.value = 0
    reasons = [r["reason"] for r in deployed.returned_for(hex_of(direct_alice))["items"]]
    assert any("not valid JSON" in x for x in reasons) and any("JSON object" in x for x in reasons)
    assert any("at most 8000 characters" in x for x in reasons)
    assert deployed.get_protocol_info()["total_bonded"] == "0"


def test_a_window_may_open_immediately_or_later(direct_vm, deployed, direct_alice):
    now_rid = create(deployed, direct_vm, direct_alice, start=T0)
    later_rid = create(deployed, direct_vm, direct_alice, start=T0 + DAY, end=T0 + 2 * DAY)
    assert deployed.get_recon(now_rid)["observation_window_start"] == T0
    assert deployed.get_recon(later_rid)["observation_window_start"] == T0 + DAY
