"""Deploy contracts/recon.py to GenLayer StudioNet and verify the deployment.

    python scripts/deploy.py [--revision HEAD] [--out docs/deployment.json]

In order:

  1. read the contract as git stores it at the revision (LF endings), so the
     deployed bytes are exactly the repository's bytes;
  2. create a throwaway deployer and fund it from the StudioNet faucet — no
     private key is requested, printed or stored, and the deployer holds no
     privilege in the contract (RECON has no owner);
  3. deploy, wait for ACCEPTED, capture the address;
  4. wait for the deployment transaction to be FINALIZED;
  5. read the code GenLayer stores back (`gen_getContractCode`) and require it
     to be byte-identical, then read the schema and get_protocol_info;
  6. write the record and print the frontend environment lines.

Exits non-zero if any check fails.
"""
import pathlib
import sys
import argparse
import base64
import hashlib
import json
import subprocess
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")


def rpc(method, params, attempts=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(attempts):
        try:
            req = urllib.request.Request(RPC, data=body, headers={
                "Content-Type": "application/json", "User-Agent": UA})
            out = json.load(urllib.request.urlopen(req, timeout=120))
            if "error" in out:
                raise RuntimeError(f"{method}: {out['error']}")
            return out["result"]
        except RuntimeError:
            raise
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(5 + 5 * i)


def utc():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--revision", default="HEAD")
    ap.add_argument("--out", default="docs/deployment.json")
    args = ap.parse_args()

    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionStatus

    commit = subprocess.run(["git", "rev-parse", args.revision], cwd=ROOT, capture_output=True,
                            text=True, check=True).stdout.strip()
    source = subprocess.run(["git", "show", f"{commit}:contracts/recon.py"], cwd=ROOT,
                            capture_output=True, check=True).stdout.replace(b"\r\n", b"\n")
    digest = hashlib.sha256(source).hexdigest()
    print(f"source    contracts/recon.py @ {commit[:12]}  {len(source)} bytes  sha256 {digest}")

    deployer = Account.create()
    rpc("sim_fundAccount", [deployer.address, 10 ** 18])
    client = create_client(chain=studionet, account=deployer)
    for _ in range(60):
        if int(client.get_balance(deployer.address)) > 0:
            break
        time.sleep(5)
    else:
        print("faucet did not fund the deployer")
        return 1
    print(f"deployer  {deployer.address} (throwaway, faucet-funded, no contract privileges)")

    tx = client.deploy_contract(code=source)
    tx = tx.hex() if hasattr(tx, "hex") else str(tx)
    print(f"submitted {tx}")
    accepted = client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                                   interval=5000, retries=360)
    address = (accepted.get("data") or {}).get("contract_address")
    leader = ((accepted.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
    print(f"accepted  {accepted.get('result_name')}  execution {leader.get('execution_result')}  address {address}")
    if not address or leader.get("execution_result") != "SUCCESS":
        print("deployment did not succeed")
        return 1

    finalized = client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.FINALIZED,
                                                    interval=10000, retries=360)
    print(f"finalized {finalized.get('status_name')}")

    onchain = base64.b64decode(rpc("gen_getContractCode", [address]))
    match = onchain == source
    print(f"on-chain  {len(onchain)} bytes  sha256 {hashlib.sha256(onchain).hexdigest()}  "
          f"{'MATCH' if match else 'DIFFER'}")
    schema = client.get_contract_schema(address)
    methods = sorted((schema.get("methods") or {}).keys())
    info = client.read_contract(address=address, function_name="get_protocol_info", args=[])

    record = {
        "network": "GenLayer StudioNet", "chain_id": studionet.id, "rpc": RPC,
        "explorer": f"https://explorer-studio.genlayer.com/address/{address}",
        "contract_address": address, "deploy_tx": tx,
        "deploy_status": finalized.get("status_name"), "deploy_consensus": accepted.get("result_name"),
        "source": "contracts/recon.py", "source_commit": commit, "source_sha256": digest,
        "source_bytes": len(source), "onchain_sha256": hashlib.sha256(onchain).hexdigest(),
        "byte_identical": match, "protocol_version": info.get("protocol_version"),
        "genvm_runner": source.decode("utf-8").splitlines()[0].split('"')[3],
        "schema_methods": methods, "deployed_at": utc(),
        "toolchain": {"genlayer_cli": "0.39.2", "genlayer_py": "0.16.3", "genlayer_test": "0.29.2",
                      "genvm_linter": "0.11.0", "genlayer_js": "1.1.8"},
    }
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"record    {out.relative_to(ROOT)}")
    print("\nfrontend environment (.env.local):")
    print(f"NEXT_PUBLIC_GENLAYER_NETWORK=studionet")
    print(f"NEXT_PUBLIC_GENLAYER_CHAIN={studionet.id}")
    print(f"NEXT_PUBLIC_RECON_CONTRACT={address}")
    return 0 if match and str(info.get("protocol_version", "")).startswith("RECON") else 1


if __name__ == "__main__":
    raise SystemExit(main())
