"""Carry abandoned requests through to their refunds.

Anyone may finalize a pending result, close a request whose observation window
has ended, and send its refund; the GEN goes only to the recorded creator. A
test run that stops part-way leaves requests like these. This sends, for each
id, whichever of those acts the request is ready for, from a throwaway
faucet-funded account, and prints every transaction.

    python scripts/settle_leftovers.py <address> <recon_id> [<recon_id> ...]
"""
import json
import sys
import time
import urllib.request

RPC = "https://studio.genlayer.com/api"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=120)).get("result")


def main() -> int:
    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionStatus

    import re
    from genlayer_py.provider.provider import GenLayerProvider

    # StudioNet refuses calls over 30 a minute (and 500 an hour) with -32029
    # before processing them; wait as long as it says and send again
    original = GenLayerProvider.make_request

    def patient(self, method, params):
        for _ in range(20):
            try:
                return original(self, method, params)
            except Exception as e:
                if "-32029" not in str(e) and "Rate limit" not in str(e):
                    raise
                m = re.search(r"retry_after_seconds\W+(\d+)", str(e))
                time.sleep((int(m.group(1)) if m else 65) + 5)
        return original(self, method, params)

    GenLayerProvider.make_request = patient

    address, ids = sys.argv[1], sys.argv[2:]
    acct = Account.create()
    rpc("sim_fundAccount", [acct.address, 10 ** 18])
    c = create_client(chain=studionet, account=acct)
    for _ in range(40):
        if int(c.get_balance(acct.address)) > 0:
            break
        time.sleep(3)

    def send(fn, rid):
        tx = c.write_contract(address=address, function_name=fn, args=[rid])
        r = c.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED, interval=5000, retries=240)
        leader = ((r.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        print(f"  {fn:<16} #{rid:<3} {tx.hex() if hasattr(tx, 'hex') else tx}  {r.get('status_name')} {leader.get('execution_result')}")
        return leader.get("execution_result") == "SUCCESS"

    now = int(time.time())
    for rid in ids:
        r = c.read_contract(address=address, function_name="get_recon", args=[rid])
        if r["status"] == "PROPOSED":
            send("finalize_result", rid)
            r = c.read_contract(address=address, function_name="get_recon", args=[rid])
        if r["status"] in ("SUBMITTED", "FINALIZED") and now > int(r["observation_window_end"]):
            send("close_recon", rid)
            r = c.read_contract(address=address, function_name="get_recon", args=[rid])
        if r["bond_status"] == "REFUNDABLE":
            send("refund_bond", rid)
            r = c.read_contract(address=address, function_name="get_recon", args=[rid])
        print(f"#{rid}: {r['status']}, bond {r['bond_status']}, state {r['current_state'] or '-'}")
    print("total_bonded", c.read_contract(address=address, function_name="get_protocol_info", args=[])["total_bonded"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
