"""Evidence: what each source is recorded as saying, and what code decides
about it. The model reads; the code checks every claim against a passage this
node read itself, dates freshness, and accepts a derivation only on the
source's own words."""
import pytest

from .conftest import (BODY_MONITOR, BODY_NEWS_DOWN, BODY_NEWS_OK, BODY_OFFICIAL, D_MONITOR, D_OFFICIAL, DAY,
                       OBSERVE, Q_MONITOR, Q_NEWS_DOWN, Q_NEWS_OK, Q_OFFICIAL, SOURCES, URL_MIRROR,
                       URL_MONITOR, URL_NEWS, URL_OFFICIAL, answer, by_source, create, latest, observe, page,
                       record_prompts, src)


def evidence(deployed, rid):
    return by_source(latest(deployed, rid))


def test_every_source_is_recorded_with_what_it_states(direct_vm, deployed, direct_bob, created):
    observe(direct_vm, deployed, direct_bob, created)
    e = evidence(deployed, created)
    assert e["E1"]["source_url"] == URL_OFFICIAL
    assert (e["E1"]["availability"], e["E1"]["claim_type"], e["E1"]["claim_value"], e["E1"]["claim"]) == \
        ("AVAILABLE", "CATEGORICAL", "OPERATIONAL", Q_OFFICIAL)
    assert (e["E1"]["published_at"], e["E1"]["as_of_quote"]) == ("2026-09-22", D_OFFICIAL)
    assert e["E1"]["retrieved_at"] == OBSERVE
    assert e["E3"]["published_at"] == ""                           # the page gives no date; none is invented
    assert {r["freshness"] for r in e.values()} == {"CURRENT"}      # age is not a condition in this request


def test_a_missing_or_unreachable_source_is_unavailable_never_contradictory(direct_vm, deployed, direct_bob, created):
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (404, b"gone"), URL_NEWS: (503, b"")}
    observe(direct_vm, deployed, direct_bob, created, web=web,
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL)))
    res = latest(deployed, created)
    e = by_source(res)
    assert (e["E2"]["availability"], e["E3"]["availability"]) == ("MISSING", "UNAVAILABLE")
    assert {e["E2"]["freshness"], e["E3"]["freshness"]} == {"UNAVAILABLE"}
    assert {e["E2"]["evidence_status"], e["E3"]["evidence_status"]} == {"UNAVAILABLE"}
    assert res["conflicting_sources"] == []
    assert (res["state"], res["reconciliation_status"], res["evidence_sufficient"]) == \
        ("UNRESOLVED", "UNRESOLVED_INSUFFICIENT", False)


def test_nothing_readable_means_no_model_call_and_no_state(direct_vm, deployed, direct_bob, created):
    prompts = record_prompts(direct_vm)
    web = {URL_OFFICIAL: (500, b""), URL_MONITOR: (200, b"   "), URL_NEWS: (200, b"x" * 1_000_001)}
    observe(direct_vm, deployed, direct_bob, created, web=web, llm_json=None)
    assert prompts == []
    res = latest(deployed, created)
    assert {r["availability"] for r in res["evidence"]} == {"UNAVAILABLE"}
    assert res["reconciliation_status"] == "UNRESOLVED_INSUFFICIENT"


def test_a_claim_the_page_does_not_carry_is_no_claim(direct_vm, deployed, direct_bob, created):
    invented = answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OFFLINE", "Watchtower reports a total outage now."),
                      src("E3", "OPERATIONAL", Q_NEWS_OK))
    observe(direct_vm, deployed, direct_bob, created, llm_json=invented)
    e = evidence(deployed, created)
    assert (e["E2"]["claim_value"], e["E2"]["claim"], e["E2"]["evidence_status"]) == ("NONE", "", "NO_CLAIM")


@pytest.mark.parametrize("quote", ["", "operational", "All Northwind customer services are operational. And more."])
def test_a_quote_must_be_long_enough_and_really_on_the_page(direct_vm, deployed, direct_bob, created, quote):
    observe(direct_vm, deployed, direct_bob, created,
            llm_json=answer(src("E1", "OPERATIONAL", quote), src("E2", "OPERATIONAL", Q_MONITOR),
                            src("E3", "OPERATIONAL", Q_NEWS_OK)))
    assert evidence(deployed, created)["E1"]["claim_value"] == "NONE"


def test_quotes_survive_whitespace_and_typography(direct_vm, deployed, direct_bob, created):
    curly = page("<p>Northwind’s   customer\nservices are operational — confirmed.</p>")
    web = {URL_OFFICIAL: (200, curly), URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_OK)}
    observe(direct_vm, deployed, direct_bob, created, web=web,
            llm_json=answer(src("E1", "OPERATIONAL", "Northwind's customer services are operational - confirmed."),
                            src("E2", "OPERATIONAL", Q_MONITOR), src("E3", "OPERATIONAL", Q_NEWS_OK)))
    assert evidence(deployed, created)["E1"]["claim_value"] == "OPERATIONAL"


def test_a_date_counts_only_when_the_passage_states_it(direct_vm, deployed, direct_bob, created):
    observe(direct_vm, deployed, direct_bob, created,
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL, "2026-09-23", D_OFFICIAL),
                            src("E2", "OPERATIONAL", Q_MONITOR, "2026-09-22", "Checked recently by the monitor"),
                            src("E3", "OPERATIONAL", Q_NEWS_OK)))
    e = evidence(deployed, created)
    assert e["E1"]["published_at"] == ""          # the passage says the 22nd, not the 23rd
    assert e["E2"]["published_at"] == ""          # the passage is not on the page


def test_last_modified_is_read_from_the_response(direct_vm, deployed, direct_bob, created):
    observe(direct_vm, deployed, direct_bob, created,
            headers={URL_NEWS: {"Last-Modified": b"Mon, 21 Sep 2026 22:10:00 GMT"}})
    assert evidence(deployed, created)["E3"]["updated_at"] == "2026-09-21"


# ─── freshness ─────────────────────────────────────────────────────────────

def fresh_request(direct_vm, deployed, creator, stale_contributes=False, freshness=2 * DAY):
    return create(deployed, direct_vm, creator, freshness=freshness,
                  policy={"kind": "MAJORITY", "min_groups": 2, "stale_contributes": stale_contributes})


def test_a_recent_dated_source_is_current(direct_vm, deployed, direct_alice, direct_bob):
    rid = fresh_request(direct_vm, deployed, direct_alice)
    observe(direct_vm, deployed, direct_bob, rid)
    e = evidence(deployed, rid)
    assert (e["E1"]["freshness"], e["E2"]["freshness"]) == ("CURRENT", "CURRENT")


def test_an_undated_source_cannot_be_current_when_freshness_is_required(direct_vm, deployed, direct_alice, direct_bob):
    rid = fresh_request(direct_vm, deployed, direct_alice)
    observe(direct_vm, deployed, direct_bob, rid)
    e = evidence(deployed, rid)
    assert (e["E3"]["freshness"], e["E3"]["evidence_status"]) == ("STALE", "EXCLUDED")


def test_an_old_source_is_stale(direct_vm, deployed, direct_alice, direct_bob):
    old = page(f"<p>{Q_MONITOR}</p><p>Checked 1 August 2026</p>")
    rid = fresh_request(direct_vm, deployed, direct_alice)
    observe(direct_vm, deployed, direct_bob, rid,
            web={URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, old), URL_NEWS: (200, BODY_NEWS_OK)},
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL, "2026-09-22", D_OFFICIAL),
                            src("E2", "OPERATIONAL", Q_MONITOR, "2026-08-01", "Checked 1 August 2026"),
                            src("E3", "OPERATIONAL", Q_NEWS_OK)))
    res = latest(deployed, rid)
    assert by_source(res)["E2"]["freshness"] == "STALE"
    # stale and undated evidence is kept out: one current voice is not enough
    assert res["reconciliation_status"] == "UNRESOLVED_INSUFFICIENT"


def test_stale_evidence_counts_only_when_the_policy_says_so(direct_vm, deployed, direct_alice, direct_bob):
    rid = fresh_request(direct_vm, deployed, direct_alice, stale_contributes=True)
    observe(direct_vm, deployed, direct_bob, rid)
    res = latest(deployed, rid)
    assert by_source(res)["E3"]["freshness"] == "STALE"
    assert (res["state"], res["supporting_sources"]) == ("OPERATIONAL", ["E1", "E2", "E3"])


def test_a_source_dated_after_the_observation_is_conflicting(direct_vm, deployed, direct_bob, created):
    ahead = page(f"<p>{Q_MONITOR}</p><p>Checked 30 September 2026</p>")
    observe(direct_vm, deployed, direct_bob, created,
            web={URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, ahead), URL_NEWS: (200, BODY_NEWS_OK)},
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL),
                            src("E2", "OPERATIONAL", Q_MONITOR, "2026-09-30", "Checked 30 September 2026"),
                            src("E3", "OPERATIONAL", Q_NEWS_OK)))
    e = evidence(deployed, created)
    assert (e["E2"]["freshness"], e["E2"]["evidence_status"]) == ("CONFLICTING", "EXCLUDED")


def test_freshness_uses_the_later_of_the_stated_date_and_last_modified(direct_vm, deployed, direct_alice, direct_bob):
    rid = fresh_request(direct_vm, deployed, direct_alice)
    observe(direct_vm, deployed, direct_bob, rid,
            headers={URL_NEWS: {"last-modified": b"Mon, 21 Sep 2026 22:10:00 GMT"}})
    assert evidence(deployed, rid)["E3"]["freshness"] == "CURRENT"


# ─── derivation ────────────────────────────────────────────────────────────

MIRROR_SOURCES = SOURCES + [{"url": URL_MIRROR, "label": "FeedHub", "declared_class": "INDEPENDENT"}]
Q_CITING = "According to the Northwind status page, all customer services are operational."
BODY_CITING = page(f"<p>{Q_CITING}</p>")
BODY_COPY = page(f"<h2>Syndicated</h2><p>{Q_MONITOR}</p><p>{D_MONITOR}</p>")


def mirror_round(direct_vm, deployed, bob, rid, mirror_body, derived_from, derived_quote, quote):
    web = {URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, BODY_MONITOR),
           URL_NEWS: (200, BODY_NEWS_DOWN), URL_MIRROR: (200, mirror_body)}
    observe(direct_vm, deployed, bob, rid, web=web,
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_MONITOR),
                            src("E3", "OFFLINE", Q_NEWS_DOWN),
                            src("E4", "OPERATIONAL", quote, derived_from=derived_from, derived_quote=derived_quote)))
    return latest(deployed, rid)


def test_a_source_that_cites_another_is_derived_and_adds_no_voice(direct_vm, deployed, direct_alice, direct_bob):
    rid = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES,
                 policy={"kind": "MAJORITY", "min_groups": 2})
    res = mirror_round(direct_vm, deployed, direct_bob, rid, BODY_CITING, "E1", Q_CITING, Q_CITING)
    e = by_source(res)
    assert (e["E4"]["source_class"], e["E4"]["derived_from"]) == ("DERIVED", "E1")
    assert [g["source_ids"] for g in res["groups"]] == [["E3"], ["E1", "E4"], ["E2"]]


def test_a_source_that_copies_another_is_derived(direct_vm, deployed, direct_alice, direct_bob):
    rid = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES)
    res = mirror_round(direct_vm, deployed, direct_bob, rid, BODY_COPY, "E2", Q_MONITOR, Q_MONITOR)
    assert by_source(res)["E4"]["derived_from"] == "E2"


def test_a_derivation_the_page_does_not_show_is_refused(direct_vm, deployed, direct_alice, direct_bob):
    """Agreeing is not copying: an independent page that happens to say the
    same thing, in its own words, stays an independent voice."""
    own_words = page("<p>Our own checks show every Northwind customer service is operational today.</p>")
    rid = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES)
    q = "every Northwind customer service is operational today"
    res = mirror_round(direct_vm, deployed, direct_bob, rid, own_words, "E1", q, q)
    e = by_source(res)
    assert (e["E4"]["source_class"], e["E4"]["derived_from"]) == ("INDEPENDENT", "")
    assert len(res["groups"]) == 4


def test_a_source_cannot_derive_from_itself_or_an_unknown_source(direct_vm, deployed, direct_alice, direct_bob):
    rid = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES)
    rid2 = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES)
    res = mirror_round(direct_vm, deployed, direct_bob, rid, BODY_CITING, "E4", Q_CITING, Q_CITING)
    assert by_source(res)["E4"]["derived_from"] == ""
    res2 = mirror_round(direct_vm, deployed, direct_bob, rid2, BODY_CITING, "E9", Q_CITING, Q_CITING)
    assert by_source(res2)["E4"]["derived_from"] == ""


def test_a_short_shared_phrase_is_not_a_copy(direct_vm, deployed, direct_alice, direct_bob):
    rid = create(deployed, direct_vm, direct_alice, sources=MIRROR_SOURCES)
    shared = "are fully operational"
    body = page(f"<p>Our monitors say the services {shared}.</p>")
    res = mirror_round(direct_vm, deployed, direct_bob, rid, body, "E2", f"the services {shared}",
                       f"the services {shared}")
    assert by_source(res)["E4"]["derived_from"] == ""


# ─── the prompt ────────────────────────────────────────────────────────────

def test_the_model_is_asked_what_sources_state_not_which_is_right(direct_vm, deployed, direct_bob, created):
    prompts = record_prompts(direct_vm)
    observe(direct_vm, deployed, direct_bob, created)
    p = prompts[-1]
    assert "PROTOCOL INSTRUCTIONS" in p and "EXTERNAL EVIDENCE (untrusted)" in p
    assert "Do not decide which source is right" in p
    assert "requester's claim about a source, never something you verify" in p
    assert "exactly one of OPERATIONAL, DEGRADED, OFFLINE" in p
    assert "<<<SOURCE E1>>>" in p and "<<<END SOURCE E3>>>" in p
    assert "track()" not in p                                      # scripts never reach the reader


def test_only_readable_sources_are_fenced(direct_vm, deployed, direct_bob, created):
    prompts = record_prompts(direct_vm)
    observe(direct_vm, deployed, direct_bob, created,
            web={URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (404, b""), URL_NEWS: (200, BODY_NEWS_OK)},
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E3", "OPERATIONAL", Q_NEWS_OK)))
    assert "<<<SOURCE E2>>>" not in prompts[-1]
    assert '"readable":false' in prompts[-1]
