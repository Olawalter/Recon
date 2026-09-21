"""Reconciliation policies, applied in code to independent groups of sources.
The same evidence under different policies gives different, predictable
outcomes, and UNRESOLVED is a first-class result, never a coin toss."""
import pytest

from .conftest import (BODY_MONITOR, BODY_NEWS_DOWN, BODY_NEWS_OK, BODY_OFFICIAL, Q_MONITOR, Q_NEWS_DOWN,
                       Q_NEWS_OK, Q_OFFICIAL, SOURCES, URL_MONITOR, URL_NEWS, URL_OFFICIAL, URL_OFFICIAL_BLOG,
                       answer, by_source, create, latest, observe, page, src)

WEB_SPLIT = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_DOWN)}
READ_SPLIT = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_MONITOR),
                    src("E3", "OFFLINE", Q_NEWS_DOWN))


def run(direct_vm, deployed, alice, bob, policy, web=WEB_SPLIT, read=READ_SPLIT, **over):
    rid = create(deployed, direct_vm, alice, policy=policy, **over)
    assert rid, "request refused"
    observe(direct_vm, deployed, bob, rid, web=web, llm_json=read)
    return latest(deployed, rid)


def outcome(res):
    return res["state"], res["reconciliation_status"], res["supporting_sources"], res["conflicting_sources"]


# ─── MAJORITY ─────────────────────────────────────────────────────────────

def test_majority_resolves_two_against_one(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2})
    assert outcome(res) == ("OPERATIONAL", "RESOLVED", ["E1", "E2"], ["E3"])
    assert by_source(res)["E3"]["evidence_status"] == "CONFLICTING"


def test_majority_needs_its_minimum_of_agreeing_groups(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 3})
    assert outcome(res)[:2] == ("UNRESOLVED", "UNRESOLVED_CONFLICT")
    assert res["evidence_sufficient"] is True                       # enough voices; they just disagree


def test_a_tie_is_never_broken(direct_vm, deployed, direct_alice, direct_bob):
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (404, b""), URL_NEWS: (200, BODY_NEWS_DOWN)}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E3", "OFFLINE", Q_NEWS_DOWN))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2}, web, read)
    assert outcome(res) == ("UNRESOLVED", "UNRESOLVED_CONFLICT", [], ["E1", "E3"])


def test_two_pages_of_one_publisher_are_one_voice(direct_vm, deployed, direct_alice, direct_bob):
    """The official status page and the official blog agree with each other and
    disagree with one independent monitor: that is one voice against one, not
    two against one."""
    sources = [SOURCES[0], {"url": URL_OFFICIAL_BLOG, "declared_class": "OFFICIAL"}, SOURCES[1]]
    blog = page(f"<p>{Q_OFFICIAL}</p>")
    down = page("<p>Watchtower: Northwind services are offline and failing every check.</p>")
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_OFFICIAL_BLOG: (200, blog), URL_MONITOR: (200, down)}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_OFFICIAL),
                  src("E3", "OFFLINE", "Northwind services are offline and failing every check"))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2}, web, read,
              sources=sources)
    assert [g["source_ids"] for g in res["groups"]] == [["E1", "E2"], ["E3"]]
    assert outcome(res)[:2] == ("UNRESOLVED", "UNRESOLVED_CONFLICT")


def test_a_publisher_contradicting_itself_supports_nothing(direct_vm, deployed, direct_alice, direct_bob):
    sources = [SOURCES[0], {"url": URL_OFFICIAL_BLOG}, SOURCES[1], SOURCES[2]]
    blog_down = page("<p>We are investigating: Northwind services are offline for most customers.</p>")
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_OFFICIAL_BLOG: (200, blog_down),
           URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_OK)}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL),
                  src("E2", "OFFLINE", "Northwind services are offline for most customers"),
                  src("E3", "OPERATIONAL", Q_MONITOR), src("E4", "OPERATIONAL", Q_NEWS_OK))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2}, web, read,
              sources=sources)
    northwind = next(g for g in res["groups"] if g["group"] == "northwind.test")
    assert northwind["claim"] == ""                                  # a split voice claims nothing
    # The state rests on the two groups that speak (E3, E4). Sources are still
    # reported by what they say: E1 states the reconciled value, E2 contradicts it.
    assert res["summary"].startswith("2 of 3 independent source group(s) establish OPERATIONAL")
    assert outcome(res) == ("OPERATIONAL", "RESOLVED", ["E1", "E3", "E4"], ["E2"])


# ─── THRESHOLD ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bps,expect", [(6666, "RESOLVED"), (6667, "UNRESOLVED_CONFLICT")])
def test_threshold_is_integer_basis_points(direct_vm, deployed, direct_alice, direct_bob, bps, expect):
    """Two of three groups is 6666.67 basis points: it meets 6666, not 6667."""
    res = run(direct_vm, deployed, direct_alice, direct_bob,
              {"kind": "THRESHOLD", "min_groups": 2, "threshold_bps": bps})
    assert res["reconciliation_status"] == expect


# ─── AUTHORITY_CONFIRMATION ───────────────────────────────────────────────

AUTHORITY = {"kind": "AUTHORITY_CONFIRMATION", "min_confirmations": 1}


def test_authority_confirmed_by_an_independent_source_resolves(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, AUTHORITY)
    assert outcome(res) == ("OPERATIONAL", "RESOLVED", ["E1", "E2"], ["E3"])


def test_authority_without_confirmation_is_unresolved(direct_vm, deployed, direct_alice, direct_bob):
    web = dict(WEB_SPLIT)
    web[URL_MONITOR] = (200, page("<p>Northwind services are responding normally? No: offline.</p>"))
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL),
                  src("E2", "OFFLINE", "Northwind services are responding normally? No: offline."),
                  src("E3", "OFFLINE", Q_NEWS_DOWN))
    res = run(direct_vm, deployed, direct_alice, direct_bob, AUTHORITY, web, read)
    assert outcome(res)[:2] == ("UNRESOLVED", "UNRESOLVED_CONFLICT")


def test_authority_that_is_unreadable_cannot_be_confirmed(direct_vm, deployed, direct_alice, direct_bob):
    web = dict(WEB_SPLIT)
    web[URL_OFFICIAL] = (503, b"")
    read = answer(src("E2", "OPERATIONAL", Q_MONITOR), src("E3", "OFFLINE", Q_NEWS_DOWN))
    res = run(direct_vm, deployed, direct_alice, direct_bob, AUTHORITY, web, read)
    assert outcome(res)[:2] == ("UNRESOLVED", "UNRESOLVED_INSUFFICIENT")


def test_confirmation_must_come_from_another_publisher(direct_vm, deployed, direct_alice, direct_bob):
    sources = [SOURCES[0], {"url": URL_OFFICIAL_BLOG, "declared_class": "INDEPENDENT"}, SOURCES[1]]
    blog = page(f"<p>{Q_OFFICIAL}</p>")
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_OFFICIAL_BLOG: (200, blog), URL_MONITOR: (404, b"")}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_OFFICIAL))
    res = run(direct_vm, deployed, direct_alice, direct_bob, AUTHORITY, web, read, sources=sources)
    assert res["reconciliation_status"] == "UNRESOLVED_INSUFFICIENT"


# ─── STRICT ───────────────────────────────────────────────────────────────

def test_strict_refuses_any_material_contradiction(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "STRICT", "min_groups": 2})
    assert outcome(res) == ("UNRESOLVED", "UNRESOLVED_CONFLICT", [], ["E1", "E2", "E3"])


def test_strict_resolves_when_every_counted_group_agrees(direct_vm, deployed, direct_alice, direct_bob):
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_OK)}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_MONITOR),
                  src("E3", "OPERATIONAL", Q_NEWS_OK))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "STRICT", "min_groups": 3}, web, read)
    assert outcome(res) == ("OPERATIONAL", "RESOLVED", ["E1", "E2", "E3"], [])


def test_agreement_among_too_few_groups_is_uncontested_but_unresolved(direct_vm, deployed, direct_alice, direct_bob):
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (404, b""), URL_NEWS: (404, b"")}
    read = answer(src("E1", "OPERATIONAL", Q_OFFICIAL))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "STRICT", "min_groups": 2}, web, read)
    assert outcome(res) == ("UNRESOLVED", "UNRESOLVED_INSUFFICIENT", [], [])
    assert by_source(res)["E1"]["evidence_status"] == "UNCONTESTED"


# ─── result types ─────────────────────────────────────────────────────────

def test_boolean_results(direct_vm, deployed, direct_alice, direct_bob):
    read = answer(src("E1", "TRUE", Q_OFFICIAL), src("E2", "true", Q_MONITOR), src("E3", "FALSE", Q_NEWS_DOWN))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2},
              read=read, result_type={"kind": "BOOLEAN"})
    assert outcome(res) == ("TRUE", "RESOLVED", ["E1", "E2"], ["E3"])


NUMERIC = {"kind": "NUMERIC", "unit": "requests per second", "decimals": 1, "tolerance_bps": 200}


def numeric_web(a, b, c):
    return {URL_OFFICIAL: (200, page(f"<p>Current throughput: {a} requests per second.</p>")),
            URL_MONITOR: (200, page(f"<p>Measured load {b} requests per second at noon.</p>")),
            URL_NEWS: (200, page(f"<p>The service handled {c} requests per second.</p>"))}


def numeric_read(a, b, c):
    return answer(src("E1", a, f"Current throughput: {a} requests per second."),
                  src("E2", b, f"Measured load {b} requests per second at noon."),
                  src("E3", c, f"The service handled {c} requests per second."))


def test_numbers_within_tolerance_agree_and_the_median_is_the_state(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2},
              numeric_web("1,000", "1010", "990"), numeric_read("1,000", "1010", "990"), result_type=NUMERIC)
    assert outcome(res) == ("1000.0", "RESOLVED", ["E1", "E2", "E3"], [])


def test_numbers_outside_tolerance_conflict(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2},
              numeric_web("1000", "1010", "1500"), numeric_read("1000", "1010", "1500"), result_type=NUMERIC)
    assert outcome(res) == ("1000.0", "RESOLVED", ["E1", "E2"], ["E3"])


def test_a_number_the_quote_does_not_state_is_no_claim(direct_vm, deployed, direct_alice, direct_bob):
    """The model reads; it never converts. 1 thousand is not written as 1000."""
    web = numeric_web("1000", "1010", "990")
    read = answer(src("E1", "1000", "Current throughput: 1000 requests per second."),
                  src("E2", "1.01", "Measured load 1010 requests per second at noon."),
                  src("E3", "990", "The service handled 990 requests per second."))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2}, web, read,
              result_type=NUMERIC)
    assert by_source(res)["E2"]["claim_value"] == "NONE"


TEMPORAL = {"kind": "TEMPORAL"}


def test_dates_are_read_in_the_forms_pages_use(direct_vm, deployed, direct_alice, direct_bob):
    web = {URL_OFFICIAL: (200, page("<p>Release Date: Oct. 2, 2023</p>")),
           URL_MONITOR: (200, page("<p>It was released on 2 October 2023.</p>")),
           URL_NEWS: (200, page("<p>releaseDate 2023-10-02</p>"))}
    read = answer(src("E1", "2023-10-02", "Release Date: Oct. 2, 2023"),
                  src("E2", "2023-10-02", "It was released on 2 October 2023."),
                  src("E3", "2023-10-02", "releaseDate 2023-10-02"))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "STRICT", "min_groups": 3}, web, read,
              result_type=TEMPORAL)
    assert outcome(res) == ("2023-10-02", "RESOLVED", ["E1", "E2", "E3"], [])


def test_a_date_the_quote_does_not_state_is_no_claim(direct_vm, deployed, direct_alice, direct_bob):
    web = {URL_OFFICIAL: (200, page("<p>Release Date: Oct. 2, 2023</p>")),
           URL_MONITOR: (200, page("<p>It was released in early October 2023.</p>")),
           URL_NEWS: (200, page("<p>releaseDate 2023-10-02</p>"))}
    read = answer(src("E1", "2023-10-02", "Release Date: Oct. 2, 2023"),
                  src("E2", "2023-10-02", "It was released in early October 2023."),
                  src("E3", "2023-10-02", "releaseDate 2023-10-02"))
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2}, web, read,
              result_type=TEMPORAL)
    assert by_source(res)["E2"]["claim_value"] == "NONE"


def test_the_summary_is_written_by_code_from_the_structured_result(direct_vm, deployed, direct_alice, direct_bob):
    res = run(direct_vm, deployed, direct_alice, direct_bob, {"kind": "MAJORITY", "min_groups": 2})
    assert res["summary"] == "2 of 3 independent source group(s) establish OPERATIONAL under MAJORITY"
