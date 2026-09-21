"""Live reconciliation on StudioNet: real pages, real validators, real
consensus. Each test asserts only what its record can prove; what a model
happened to say about a demonstration page is recorded, not asserted, unless
the contract's own checks make it certain."""
import pytest

from .conftest import ANSWER, CASES

pytestmark = pytest.mark.integration


def ev(res):
    return {e["source_id"]: e for e in res["evidence"]}


def test_every_round_reached_agreement_and_finality(world):
    world.finalized()
    for case in CASES:
        rec = world.live.record["requests"][case]
        assert rec["observe_facts"]["consensus"] == "MAJORITY_AGREE", case
        assert rec["observe_final"]["status"] == "FINALIZED", case
        assert rec["after_finality"]["status"] == "FINALIZED", case
        assert world.result(case, 0)["status"] == "FINALIZED", case


def test_two_pages_of_one_publisher_are_one_voice_and_a_missing_page_is_not_a_contradiction(world):
    world.observed()
    res = world.result("grouped", 0)
    e = ev(res)
    assert (res["state"], res["reconciliation_status"]) == (ANSWER, "RESOLVED")
    groups = {g["group"]: g["source_ids"] for g in res["groups"]}
    assert set(groups) == {"python.org", "endoflife.date"}                   # two voices, not three
    assert (e["E4"]["availability"], e["E4"]["evidence_status"]) == ("MISSING", "UNAVAILABLE")
    assert "E4" not in res["conflicting_sources"]


def test_majority_resolves_against_one_conflicting_source(world):
    world.observed()
    res = world.result("majority", 0)
    assert (res["state"], res["reconciliation_status"]) == (ANSWER, "RESOLVED")
    assert ev(res)["E3"]["claim_value"] == "2023-10-03"
    assert res["conflicting_sources"] == ["E3"]


def test_strict_leaves_the_same_evidence_unresolved(world):
    """Identical sources, identical evidence, different policy: the policy, not
    the evidence, decides whether a contradiction is tolerated."""
    world.observed()
    strict, majority = world.result("strict", 0), world.result("majority", 0)
    assert [e["claim_value"] for e in strict["evidence"]] == [e["claim_value"] for e in majority["evidence"]]
    assert (strict["state"], strict["reconciliation_status"]) == ("UNRESOLVED", "UNRESOLVED_CONFLICT")


def test_a_source_that_cites_another_adds_no_voice(world):
    world.observed()
    res = world.result("derived", 0)
    e = ev(res)
    assert (e["E3"]["source_class"], e["E3"]["derived_from"]) == ("DERIVED", "E2")
    assert e["E1"]["source_class"] == "OFFICIAL" and e["E1"]["derived_from"] == ""     # negative control
    assert len(res["groups"]) == 2
    assert (res["state"], res["reconciliation_status"]) == ("UNRESOLVED", "UNRESOLVED_INSUFFICIENT")


def test_old_evidence_is_stale_when_freshness_is_required(world):
    world.observed()
    res = world.result("stale", 0)
    assert ev(res)["E1"]["freshness"] == "STALE"
    assert ev(world.result("grouped", 0))["E1"]["freshness"] == "CURRENT"          # negative control: same page, no requirement
    assert res["reconciliation_status"] == "UNRESOLVED_INSUFFICIENT"


def test_an_official_source_confirmed_independently_resolves(world):
    world.observed()
    res = world.result("authority", 0)
    assert (res["state"], res["reconciliation_status"], res["supporting_sources"]) == (ANSWER, "RESOLVED", ["E1", "E2"])


def test_a_page_cannot_instruct_the_panel(world):
    world.observed()
    res = world.result("injection", 0)
    e = ev(res)
    assert (res["state"], res["reconciliation_status"]) == (ANSWER, "RESOLVED")
    assert (e["E1"]["claim_value"], e["E2"]["claim_value"]) == (ANSWER, ANSWER)
    assert e["E1"]["derived_from"] == "" and e["E2"]["derived_from"] == ""
    world.live.record["requests"]["injection"]["injection_source_claim"] = e["E3"]["claim_value"]


def test_expiry_and_a_new_observation_are_new_records(world):
    world.reobserved()
    rec = world.live.record["requests"]["grouped"]
    assert rec["after_expiry"]["current_state"] == "EXPIRED"
    assert world.result("grouped", 0)["state"] == ANSWER                   # the first result is untouched
    second = rec["second_result"]
    assert second["result_id"].endswith("-R1") and second["status"] == "FINALIZED"
    history = [(h["previous_state"], h["new_state"], h["kind"]) for h in reversed(rec["history"]["items"])]
    assert history == [("", ANSWER, "OBSERVED"), (ANSWER, "EXPIRED", "EXPIRED"),
                       ("EXPIRED", second["state"], "OBSERVED")]
