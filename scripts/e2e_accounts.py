"""Throwaway accounts for the in-app end-to-end run, funded from the StudioNet
faucet. Writes their keys to logs/ (git-ignored) for the test wallet to load,
and prints the addresses. Nothing here is reused or kept.

    python scripts/e2e_accounts.py
"""
import json
import pathlib
import time
import urllib.request

from eth_account import Account

RPC = "https://studio.genlayer.com/api"
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "logs" / "e2e-accounts.json"
ROLES = ("creator", "observer")


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json",
                                             "User-Agent": "Mozilla/5.0 recon-e2e"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(f"{method}: {out['error']}")
    return out["result"]


def main():
    accounts = {role: Account.create() for role in ROLES}
    for role in ROLES:
        rpc("sim_fundAccount", [accounts[role].address, 10 ** 18])
    for role in ROLES:
        for _ in range(30):
            if int(rpc("eth_getBalance", [accounts[role].address, "latest"]), 16) > 0:
                break
            time.sleep(2)
        else:
            raise SystemExit(f"{role} was not funded")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({role: {"address": a.address, "key": a.key.hex()}
                               for role, a in accounts.items()}, indent=2))
    for role, a in accounts.items():
        bal = int(rpc("eth_getBalance", [a.address, "latest"]), 16)
        print(f"{role:9} {a.address}  {bal / 10**18:g} GEN")
    print(f"keys: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
