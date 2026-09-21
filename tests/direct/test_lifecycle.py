"""The whole life of one request, end to end, in the order a user meets it."""
from .conftest import (BOND, DAY, OBSERVE, create, finalize, hex_of, latest, observe, warp_to, T0)


def test_a_request_lives_from_bond_to_refund(direct_vm, deployed, direct_alice, direct_bob, direct_charlie,
                                             transfers):
    rid = create(deployed, direct_vm, direct_alice)
    assert rid == "1"
    r = deployed.get_recon(rid)
    assert (r["status"], r["bond_status"], r["bond_required"], r["bond_deposited"]) == \
        ("SUBMITTED", "LOCKED", str(BOND), str(BOND))
    assert r["creator"].lower() == hex_of(direct_alice)
    assert [s["source_id"] for s in r["sources"]] == ["E1", "E2", "E3"]

    result_id = observe(direct_vm, deployed, direct_bob, rid)
    assert result_id == "1-R0"
    res = latest(deployed, rid)
    assert (res["state"], res["reconciliation_status"], res["evidence_sufficient"], res["status"]) == \
        ("OPERATIONAL", "RESOLVED", True, "PROPOSED")
    assert res["supporting_sources"] == ["E1", "E2", "E3"] and res["conflicting_sources"] == []
    assert deployed.get_recon(rid)["status"] == "PROPOSED"
    assert deployed.get_recon(rid)["current_state"] == ""            # nothing is current until final

    finalize(direct_vm, deployed, direct_charlie, rid)
    r = deployed.get_recon(rid)
    assert (r["status"], r["current_state"]) == ("FINALIZED", "OPERATIONAL")
    history = deployed.get_history(rid)["items"]
    assert [(h["previous_state"], h["new_state"], h["result_id"]) for h in history] == [("", "OPERATIONAL", "1-R0")]

    warp_to(direct_vm, T0 + 2 * DAY + 1)
    direct_vm.sender = direct_charlie
    deployed.close_recon(rid)
    assert (deployed.get_recon(rid)["status"], deployed.get_recon(rid)["bond_status"]) == ("CLOSED", "REFUNDABLE")

    assert deployed.refund_bond(rid) == str(BOND)
    r = deployed.get_recon(rid)
    assert (r["bond_status"], r["bond_deposited"], r["refunded_amount"]) == ("REFUNDED", "0", str(BOND))
    assert transfers == [(hex_of(direct_alice), BOND)]
    assert deployed.get_protocol_info()["total_bonded"] == "0"
