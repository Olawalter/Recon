"""A disposable live probe: deploy the working-tree contract to StudioNet,
create one request, observe it once, and print what the panel recorded.

Used to diagnose a live behaviour on a throwaway deployment before building a
suite around it. Nothing here is the deployment of record.

    python scripts/live_probe.py <url> [<url> ...]
"""
import json
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=120))["result"]


def main() -> int:
    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionStatus

    urls = sys.argv[1:]
    acct = Account.create()
    rpc("sim_fundAccount", [acct.address, 10 ** 18])
    c = create_client(chain=studionet, account=acct)
    for _ in range(60):
        if int(c.get_balance(acct.address)) > 0:
            break
        time.sleep(3)

    def wait(tx):
        return c.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                              interval=5000, retries=360)

    code = (ROOT / "contracts" / "recon.py").read_bytes().replace(b"\r\n", b"\n")
    receipt = wait(c.deploy_contract(code=code))
    address = (receipt.get("data") or {}).get("contract_address")
    print("probe deployment", address)

    now = int(time.time())
    terms = {"sources": [{"url": u} for u in urls],
             "result_type": {"kind": "TEMPORAL"},
             "policy": {"kind": "MAJORITY", "min_groups": 2},
             "observation_window_start": now, "observation_window_end": now + 3600,
             "freshness_requirement": 0, "validity_seconds": 3600}
    wait(c.write_contract(address=address, function_name="create_recon",
                          args=["When was Python 3.12.0 released?", json.dumps(terms), 10 ** 16], value=10 ** 16))
    rid = c.read_contract(address=address, function_name="list_recons", args=[0, 1])["items"][0]["recon_id"]
    tx = c.write_contract(address=address, function_name="observe_recon", args=[rid])
    r = wait(tx)
    print("observe", r.get("result_name"), ((r.get("consensus_data") or {}).get("leader_receipt") or [{}])[0].get("execution_result"))
    res = c.read_contract(address=address, function_name="get_result",
                          args=[c.read_contract(address=address, function_name="get_recon", args=[rid])["latest_result_id"]])
    for e in res["evidence"]:
        print(f"  {e['source_id']} {e['availability']:<11} {e['claim_value']:<10} {e['freshness']:<8} "
              f"{e['published_at'] or '-':<10} {e['updated_at'] or '-':<10} {e['origin']:<18} {e['claim'][:70]!r}")
    print("  ->", res["state"], res["reconciliation_status"], res["summary"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
