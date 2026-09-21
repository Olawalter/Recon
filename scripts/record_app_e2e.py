"""Record an in-app end-to-end run from the chain alone.

The run itself happens in the browser: the app's own forms, its own EIP-6963
discovery and its own transaction code, signed by the test wallet in
tests/e2e/test-wallet.js. This script takes the transaction hashes that run
produced and proves, from StudioNet, what each one was: its sender, the method
and arguments decoded from its calldata, its value, and GenLayer's verdict on
it. It then reads the request, its results and its history, and writes the lot
to docs/app-e2e.json. Every hash in the documentation comes from that file.

    python scripts/record_app_e2e.py <recon_id> <tx_hash> [<tx_hash> ...]

Exits non-zero if any transaction is not a successful, agreed call to the
deployment of record, or if the calls do not make up a whole lifecycle.
"""
import base64
import json
import pathlib
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
DEPLOYMENT = json.loads((ROOT / "docs" / "deployment.json").read_text(encoding="utf-8"))
CONTRACT = DEPLOYMENT["contract_address"]
OUT = ROOT / "docs" / "app-e2e.json"
LIFECYCLE = ["create_recon", "observe_recon", "finalize_result", "close_recon", "refund_bond"]


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 recon"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(f"{method}: {out['error']}")
    return out["result"]


def facts(tx_hash):
    from genlayer_py.abi import calldata

    t = rpc("eth_getTransactionByHash", [tx_hash]) or {}
    leader = (t.get("consensus_data") or {}).get("leader_receipt") or [{}]
    leader = leader[0] if isinstance(leader, list) else leader
    raw = ((t.get("data") or {}).get("calldata")) or ""
    call = calldata.decode(base64.b64decode(raw)) if raw else {}
    votes = list(((t.get("consensus_data") or {}).get("votes") or {}).values())
    args = [str(a) for a in call.get("args", [])]
    if call.get("method") == "create_recon" and len(args) > 1:
        args[1] = json.loads(args[1])          # the terms, kept readable
    return {
        "tx": tx_hash,
        "from": t.get("from_address"),
        "to": t.get("to_address"),
        "method": call.get("method"),
        "args": args,
        "value_atto": str(t.get("value") or 0),
        "status": t.get("status"),
        "consensus": t.get("result_name"),
        "execution": leader.get("execution_result"),
        "votes": {v: votes.count(v) for v in sorted(set(votes))},
        "created_at": t.get("created_at"),
        "explorer": f"https://explorer-studio.genlayer.com/tx/{tx_hash}",
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    rid, hashes = sys.argv[1], sys.argv[2:]

    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet

    reader = create_client(chain=studionet, account=Account.create())   # read-only, never funded
    read = lambda fn, *a: reader.read_contract(address=CONTRACT, function_name=fn, args=list(a))
    txs = [facts(h) for h in hashes]
    recon = read("get_recon", rid)
    results = read("get_results", rid, 0, 20)["items"]
    history = read("get_history", rid)

    problems = []
    for t in txs:
        if (t["to"] or "").lower() != CONTRACT.lower():
            problems.append(f"{t['tx']} is not addressed to the deployment of record")
        if t["status"] not in ("ACCEPTED", "FINALIZED") or t["execution"] != "SUCCESS" or t["consensus"] != "MAJORITY_AGREE":
            problems.append(f"{t['tx']} is {t['status']} / {t['consensus']} / {t['execution']}")
        if t["method"] != "create_recon" and t["args"][:1] != [rid]:
            problems.append(f"{t['tx']} ({t['method']}) is not about request {rid}")
    if [t["method"] for t in txs] != LIFECYCLE:
        problems.append(f"the calls are {[t['method'] for t in txs]}, not the lifecycle {LIFECYCLE}")
    if txs and txs[0]["method"] == "create_recon" and txs[0]["value_atto"] != recon["bond_required"]:
        problems.append(f"the creating transaction carried {txs[0]['value_atto']}, the bond is {recon['bond_required']}")
    if (recon["status"], recon["bond_status"], recon["bond_deposited"]) != ("CLOSED", "REFUNDED", "0"):
        problems.append(f"request {rid} ends {recon['status']} / {recon['bond_status']} / {recon['bond_deposited']}")

    record = {
        "what": "One reconciliation request taken through its whole lifecycle in the RECON app itself: the "
                "app's own create form, EIP-6963 wallet discovery and transaction code, signed by the test "
                "wallet in tests/e2e/test-wallet.js holding throwaway, faucet-funded keys. Every field below "
                "is read back from StudioNet by scripts/record_app_e2e.py.",
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "network": DEPLOYMENT["network"],
        "chain_id": DEPLOYMENT["chain_id"],
        "contract": CONTRACT,
        "recon_id": rid,
        "question": recon["question"],
        "creator": recon["creator"],
        "transactions": txs,
        "outcome": {
            "status": recon["status"],
            "current_state": recon["current_state"],
            "bond_required_atto": recon["bond_required"],
            "bond_deposited_atto": recon["bond_deposited"],
            "bond_status": recon["bond_status"],
            "refunded_atto": recon.get("refunded_amount"),
            "results": [{k: r.get(k) for k in ("result_id", "status", "reconciliation_status", "state", "summary")}
                        | {"evidence": [{k: e.get(k) for k in ("source_id", "origin", "evidence_status", "availability", "claim", "freshness",
                                                                "derived_from")} for e in r.get("evidence", [])]}
                        for r in results],
            "history": history,
        },
        "problems": problems,
    }
    OUT.write_text(json.dumps(record, indent=2, default=str) + "\n", encoding="utf-8")

    for t in txs:
        print(f"{t['method']:<16} {t['tx'][:20]}...  from {(t['from'] or '')[:10]}...  value {t['value_atto']:>17}  "
              f"{t['status']} {t['consensus']} {t['execution']}")
    print(f"request {rid}: {recon['status']}, state {recon['current_state']}, bond {recon['bond_status']} "
          f"{recon['bond_deposited']}")
    for p in problems:
        print("PROBLEM", p)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
