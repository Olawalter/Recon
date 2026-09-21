"""The request state machine and the bond. The contract is the only authority:
every transition is a write it checks, every final result is immutable, and a
new observation is a new record."""
import pytest

from .conftest import (BODY_MONITOR, BODY_NEWS_DOWN, BODY_OFFICIAL, BOND, DAY, FINALITY_DELAY, HOUR, INTERVAL,
                       OBSERVE, Q_MONITOR, Q_NEWS_DOWN, Q_OFFICIAL, T0, URL_MONITOR, URL_NEWS, URL_OFFICIAL,
                       answer, create, finalize, hex_of, latest, observe, page, src, warp_to)

END = T0 + 2 * DAY
DOWN = page("<p>Northwind's customer services are offline for every region.</p>")
Q_DOWN = "Northwind's customer services are offline for every region."
WEB_DOWN = {URL_OFFICIAL: (200, DOWN), URL_MONITOR: (200, DOWN), URL_NEWS: (200, BODY_NEWS_DOWN)}
READ_DOWN = answer(src("E1", "OFFLINE", Q_DOWN), src("E2", "OFFLINE", Q_DOWN), src("E3", "OFFLINE", Q_NEWS_DOWN))


def act(direct_vm, sender, at, fn, *args):
    warp_to(direct_vm, at)
    direct_vm.sender = sender
    return fn(*args)


# ─── observation ───────────────────────────────────────────────────────────

def test_observation_waits_for_the_window(direct_vm, deployed, direct_alice, direct_bob):
    rid = create(deployed, direct_vm, direct_alice, start=T0 + DAY, end=T0 + 2 * DAY)
    with direct_vm.expect_revert("the observation window opens at"):
        observe(direct_vm, deployed, direct_bob, rid, at=T0 + HOUR)
    assert deployed.get_recon(rid)["result_count"] == 0


def test_observation_ends_with_the_window(direct_vm, deployed, direct_bob, created):
    with direct_vm.expect_revert("the observation window closed"):
        observe(direct_vm, deployed, direct_bob, created, at=END + 1)


def test_one_result_is_pending_at_a_time(direct_vm, deployed, direct_bob, proposed):
    with direct_vm.expect_revert("no result is pending; it is PROPOSED"):
        observe(direct_vm, deployed, direct_bob, proposed, at=OBSERVE + HOUR)


def test_a_new_observation_after_finality_is_a_new_record(direct_vm, deployed, direct_bob, direct_charlie, finalized):
    first = latest(deployed, finalized)
    later = OBSERVE + FINALITY_DELAY + INTERVAL
    assert observe(direct_vm, deployed, direct_bob, finalized, at=later, web=WEB_DOWN, llm_json=READ_DOWN) == "1-R1"
    finalize(direct_vm, deployed, direct_charlie, finalized)
    r = deployed.get_recon(finalized)
    assert (r["current_state"], r["result_count"], r["latest_result_id"]) == ("OFFLINE", 2, "1-R1")
    assert deployed.get_result("1-R0") == dict(first, status="FINALIZED",
                                               finalized_at=deployed.get_result("1-R0")["finalized_at"])
    assert deployed.get_result("1-R0")["state"] == "OPERATIONAL"      # the earlier result is untouched
    history = deployed.get_history(finalized)["items"]                 # newest first
    assert [(h["previous_state"], h["new_state"], h["result_id"]) for h in history] == [
        ("OPERATIONAL", "OFFLINE", "1-R1"), ("", "OPERATIONAL", "1-R0")]
    assert [r["result_id"] for r in deployed.get_results(finalized)["items"]] == ["1-R1", "1-R0"]
    assert deployed.list_transitions()["total"] == 2


def test_observations_are_spaced(direct_vm, deployed, direct_bob, direct_charlie, created):
    """The interval outlasts finality, so it binds: a result finalized at once
    still cannot be followed by another observation until the interval passes."""
    assert INTERVAL > FINALITY_DELAY
    observe(direct_vm, deployed, direct_bob, created, at=OBSERVE)
    finalize(direct_vm, deployed, direct_charlie, created, at=OBSERVE + FINALITY_DELAY)
    assert deployed.get_recon(created)["next_observation_at"] == OBSERVE + INTERVAL
    with direct_vm.expect_revert("the next observation is possible at"):
        observe(direct_vm, deployed, direct_bob, created, at=OBSERVE + INTERVAL - 1)
    observe(direct_vm, deployed, direct_bob, created, at=OBSERVE + INTERVAL)
    assert deployed.get_recon(created)["result_count"] == 2


def test_an_unchanged_state_is_still_a_new_record(direct_vm, deployed, direct_bob, direct_charlie, finalized):
    observe(direct_vm, deployed, direct_bob, finalized, at=OBSERVE + DAY)
    finalize(direct_vm, deployed, direct_charlie, finalized)
    history = deployed.get_history(finalized)["items"]
    assert [(h["previous_state"], h["new_state"]) for h in history] == [
        ("OPERATIONAL", "OPERATIONAL"), ("", "OPERATIONAL")]


def test_results_per_request_are_bounded(direct_vm, deployed, direct_alice, direct_bob, direct_charlie):
    rid = create(deployed, direct_vm, direct_alice, end=T0 + 3 * DAY)
    at = OBSERVE
    for _ in range(100):
        observe(direct_vm, deployed, direct_bob, rid, at=at)
        finalize(direct_vm, deployed, direct_charlie, rid, at=at + FINALITY_DELAY)
        at += INTERVAL
    assert deployed.get_recon(rid)["result_count"] == 100
    with direct_vm.expect_revert("a request holds at most 100 results"):
        observe(direct_vm, deployed, direct_bob, rid, at=at)


# ─── finality ──────────────────────────────────────────────────────────────

def test_finality_waits_for_the_contract_delay(direct_vm, deployed, direct_charlie, proposed):
    with direct_vm.expect_revert("the result can be finalized at"):
        finalize(direct_vm, deployed, direct_charlie, proposed, at=OBSERVE + FINALITY_DELAY - 1)
    finalize(direct_vm, deployed, direct_charlie, proposed, at=OBSERVE + FINALITY_DELAY)
    res = latest(deployed, proposed)
    assert (res["status"], res["finalized_at"]) == ("FINALIZED", OBSERVE + FINALITY_DELAY)


def test_only_a_pending_result_can_be_finalized(direct_vm, deployed, direct_charlie, created, finalized):
    with direct_vm.expect_revert("only a pending result can be finalized"):
        finalize(direct_vm, deployed, direct_charlie, finalized, at=OBSERVE + DAY)


def test_an_unresolved_result_is_a_valid_final_outcome(direct_vm, deployed, direct_alice, direct_bob, direct_charlie):
    rid = create(deployed, direct_vm, direct_alice, policy={"kind": "STRICT", "min_groups": 2})
    observe(direct_vm, deployed, direct_bob, rid,
            web={URL_OFFICIAL: (200, BODY_OFFICIAL), URL_MONITOR: (200, BODY_MONITOR), URL_NEWS: (200, BODY_NEWS_DOWN)},
            llm_json=answer(src("E1", "OPERATIONAL", Q_OFFICIAL), src("E2", "OPERATIONAL", Q_MONITOR),
                            src("E3", "OFFLINE", Q_NEWS_DOWN)))
    finalize(direct_vm, deployed, direct_charlie, rid)
    assert (deployed.get_recon(rid)["status"], deployed.get_recon(rid)["current_state"]) == ("FINALIZED", "UNRESOLVED")


# ─── expiry ────────────────────────────────────────────────────────────────

def test_a_result_expires_only_after_its_validity(direct_vm, deployed, direct_charlie, finalized):
    valid_until = latest(deployed, finalized)["valid_until"]
    assert valid_until == OBSERVE + 6 * HOUR
    with direct_vm.expect_revert("the result is valid until"):
        act(direct_vm, direct_charlie, valid_until - 1, deployed.expire_result, finalized)
    act(direct_vm, direct_charlie, valid_until, deployed.expire_result, finalized)
    r = deployed.get_recon(finalized)
    assert r["current_state"] == "EXPIRED"
    assert latest(deployed, finalized)["state"] == "OPERATIONAL"       # the result itself is untouched
    h = deployed.get_history(finalized)["items"][0]
    assert (h["previous_state"], h["new_state"], h["kind"], h["result_id"]) == ("OPERATIONAL", "EXPIRED", "EXPIRED", "1-R0")
    with direct_vm.expect_revert("already recorded as expired"):
        act(direct_vm, direct_charlie, valid_until + 1, deployed.expire_result, finalized)


def test_nothing_to_expire_without_a_final_result(direct_vm, deployed, direct_charlie, created, proposed):
    with direct_vm.expect_revert("only a request with a final result can expire"):
        act(direct_vm, direct_charlie, T0 + DAY, deployed.expire_result, proposed)


def test_a_new_observation_can_replace_an_expired_state(direct_vm, deployed, direct_bob, direct_charlie, finalized):
    valid_until = latest(deployed, finalized)["valid_until"]
    act(direct_vm, direct_charlie, valid_until, deployed.expire_result, finalized)
    observe(direct_vm, deployed, direct_bob, finalized, at=valid_until + 1, web=WEB_DOWN, llm_json=READ_DOWN)
    finalize(direct_vm, deployed, direct_charlie, finalized)
    assert deployed.get_recon(finalized)["current_state"] == "OFFLINE"
    assert deployed.get_history(finalized)["items"][0]["previous_state"] == "EXPIRED"


# ─── closing ───────────────────────────────────────────────────────────────

def test_the_window_must_end_before_closing(direct_vm, deployed, direct_charlie, finalized):
    with direct_vm.expect_revert("the observation window is open until"):
        act(direct_vm, direct_charlie, END, deployed.close_recon, finalized)
    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, finalized)
    r = deployed.get_recon(finalized)
    assert (r["status"], r["bond_status"], r["current_state"]) == ("CLOSED", "REFUNDABLE", "OPERATIONAL")


def test_a_pending_result_must_be_finalized_before_closing(direct_vm, deployed, direct_charlie, proposed):
    with direct_vm.expect_revert("must be finalized before the request closes"):
        act(direct_vm, direct_charlie, END + 1, deployed.close_recon, proposed)


def test_a_window_without_any_result_ends_failed(direct_vm, deployed, direct_charlie, created):
    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, created)
    assert (deployed.get_recon(created)["status"], deployed.get_recon(created)["bond_status"]) == ("FAILED", "REFUNDABLE")


def test_a_closed_request_cannot_be_observed_or_closed_again(direct_vm, deployed, direct_bob, direct_charlie, finalized):
    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, finalized)
    with direct_vm.expect_revert("only an open request can be closed"):
        act(direct_vm, direct_charlie, END + 2, deployed.close_recon, finalized)
    with direct_vm.expect_revert("no result is pending; it is CLOSED"):
        observe(direct_vm, deployed, direct_bob, finalized, at=END + 3)


# ─── cancellation ──────────────────────────────────────────────────────────

def test_the_creator_may_cancel_before_any_observation(direct_vm, deployed, direct_alice, created):
    act(direct_vm, direct_alice, T0 + 60, deployed.cancel_recon, created)
    r = deployed.get_recon(created)
    assert (r["status"], r["bond_status"]) == ("CANCELLED", "REFUNDABLE")


def test_only_the_creator_may_cancel(direct_vm, deployed, direct_bob, created):
    with direct_vm.expect_revert("only the creator can cancel"):
        act(direct_vm, direct_bob, T0 + 60, deployed.cancel_recon, created)


def test_an_observed_request_cannot_be_cancelled(direct_vm, deployed, direct_alice, proposed):
    with direct_vm.expect_revert("never been observed can be cancelled"):
        act(direct_vm, direct_alice, OBSERVE + 60, deployed.cancel_recon, proposed)


# ─── the bond ──────────────────────────────────────────────────────────────

def test_a_locked_bond_cannot_be_refunded(direct_vm, deployed, direct_alice, finalized, transfers):
    with direct_vm.expect_revert("the bond is LOCKED, not refundable"):
        act(direct_vm, direct_alice, OBSERVE + DAY, deployed.refund_bond, finalized)
    assert transfers == []


def test_anyone_may_send_the_refund_but_it_goes_only_to_the_creator(direct_vm, deployed, direct_alice, direct_bob,
                                                                    direct_charlie, finalized, transfers):
    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, finalized)
    assert act(direct_vm, direct_bob, END + 2, deployed.refund_bond, finalized) == str(BOND)
    assert transfers == [(hex_of(direct_alice), BOND)]
    r = deployed.get_recon(finalized)
    assert (r["bond_status"], r["bond_deposited"], r["refunded_amount"], r["refunded_at"]) == \
        ("REFUNDED", "0", str(BOND), END + 2)


def test_the_bond_is_refunded_exactly_once(direct_vm, deployed, direct_alice, direct_charlie, finalized, transfers):
    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, finalized)
    act(direct_vm, direct_charlie, END + 2, deployed.refund_bond, finalized)
    with direct_vm.expect_revert("the bond is REFUNDED, not refundable"):
        act(direct_vm, direct_charlie, END + 3, deployed.refund_bond, finalized)
    assert transfers == [(hex_of(direct_alice), BOND)]


def test_a_cancelled_bond_is_refunded_in_full(direct_vm, deployed, direct_alice, created, transfers):
    act(direct_vm, direct_alice, T0 + 60, deployed.cancel_recon, created)
    act(direct_vm, direct_alice, T0 + 61, deployed.refund_bond, created)
    assert transfers == [(hex_of(direct_alice), BOND)]


def test_the_ledger_is_zeroed_before_the_transfer(direct_vm, deployed, direct_charlie, finalized, monkeypatch):
    """At the moment the transfer is emitted, storage already shows nothing held."""
    from gltest.direct import wasi_mock
    seen = []
    original = wasi_mock._handle_gl_call

    def spy(vm, request):
        if isinstance(request, dict) and "EthSend" in request:
            seen.append(deployed.get_recon(finalized)["bond_deposited"])
        return original(vm, request)

    act(direct_vm, direct_charlie, END + 1, deployed.close_recon, finalized)
    monkeypatch.setattr(wasi_mock, "_handle_gl_call", spy)
    act(direct_vm, direct_charlie, END + 2, deployed.refund_bond, finalized)
    assert seen == ["0"]


def test_the_bond_never_touches_the_result(direct_vm, deployed, direct_alice, direct_bob):
    small = create(deployed, direct_vm, direct_alice, bond=10 ** 15)
    large = create(deployed, direct_vm, direct_alice, bond=10 ** 20)
    observe(direct_vm, deployed, direct_bob, small)
    observe(direct_vm, deployed, direct_bob, large)
    a, b = latest(deployed, small), latest(deployed, large)
    for key in ("state", "reconciliation_status", "supporting_sources", "conflicting_sources", "evidence", "groups"):
        assert a[key] == b[key]
    assert deployed.get_protocol_info()["total_bonded"] == str(10 ** 15 + 10 ** 20)


def test_total_bonded_tracks_every_request(direct_vm, deployed, direct_alice, direct_charlie):
    first = create(deployed, direct_vm, direct_alice)
    create(deployed, direct_vm, direct_alice)
    assert deployed.get_protocol_info()["total_bonded"] == str(2 * BOND)
    act(direct_vm, direct_alice, T0 + 60, deployed.cancel_recon, first)
    act(direct_vm, direct_charlie, T0 + 61, deployed.refund_bond, first)
    assert deployed.get_protocol_info()["total_bonded"] == str(BOND)


@pytest.mark.parametrize("fn", ["cancel_recon", "observe_recon", "finalize_result", "expire_result",
                                "close_recon", "refund_bond", "get_recon", "get_history", "get_results"])
def test_an_unknown_request_is_refused_by_name(direct_vm, deployed, direct_alice, fn):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("recon 99 does not exist"):
        getattr(deployed, fn)("99")
