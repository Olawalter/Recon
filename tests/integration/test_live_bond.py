"""The bond and the walls, live. Every refusal is the contract's own, sent
without simulation and finalized, its sentence decoded from the leader
receipt. Every deposit the contract could not accept came back."""
import pytest

from .conftest import BOND, CASES

pytestmark = pytest.mark.integration


def refusal(world, key):
    entry = world.live.record["walls"][key]
    assert entry["refused"], entry
    return entry["refusal"]


def test_a_request_without_a_bond_is_refused(world):
    world.created()
    assert "Bond required" in refusal(world, "zero_bond")


def test_a_deposit_the_contract_cannot_accept_comes_back_with_its_reason(world):
    world.created()
    for key in ("inexact_bond", "too_few_origins"):
        assert not world.live.record["walls"][key]["refused"], key     # accepted as a transaction, not as a request
    reasons = [r["reason"] for r in world.live.record["returned_deposits"]["items"]]
    assert any("must be exactly" in r for r in reasons)
    assert any("needs 3 independent origins" in r for r in reasons)


def test_each_lifecycle_wall_is_refused_in_the_contracts_words(world):
    world.refunded()
    expected = {
        "observe_before_window": "the observation window opens at",
        "cancel_by_stranger": "only the creator can cancel",
        "refund_while_locked": "the bond is LOCKED, not refundable",
        "observe_while_pending": "no result is pending; it is PROPOSED",
        "finalize_early": "the result can be finalized at",
        "close_while_open": "the observation window is open until",
        "refund_twice": "the bond is REFUNDED, not refundable",
    }
    for key, words in expected.items():
        assert words in refusal(world, key), key


def test_every_bond_is_refunded_to_the_creator_exactly_once(world):
    world.refunded()
    live = world.live
    for case in CASES:
        r = live.record["requests"][case]["closed"]
        assert (r["bond_status"], r["bond_deposited"], r["refunded_amount"]) == ("REFUNDED", "0", str(BOND)), case
    cancelled = live.read("get_recon", world.ids["cancel"])
    assert (cancelled["status"], cancelled["bond_status"]) == ("CANCELLED", "REFUNDED")
    assert live.record["protocol_after"]["total_bonded"] == "0"


def test_the_creator_holds_every_bond_again(world):
    """Eight bonds were locked (seven observed requests and one cancelled);
    every one came back, as did the two refused deposits. StudioNet charges
    no gas, so the creator's balance is exactly where it started."""
    world.refunded()
    b = world.live.record["creator_balance"]
    assert int(b["after"]) == int(b["before"])
