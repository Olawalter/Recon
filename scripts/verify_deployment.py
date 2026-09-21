"""Verify a RECON deployment from the chain alone, and optionally record it.

    python scripts/verify_deployment.py <address> [--revision HEAD] [--recon 1] [--write-schema]

Prints, read from StudioNet only:
  code      the deployed code, compared byte for byte with contracts/recon.py
            as git stores it at the revision
  schema    the methods GenLayer derived from that code
  protocol  get_protocol_info
  requests  every request with its status, state and bond
  recon     with --recon: the request, every result and its history

--write-schema writes the schema to lib/genlayer/recon-schema.json, the fixture
the frontend's tests pin the app's interface against.

Exits non-zero unless the deployed code is byte-identical to the source.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": UA})
    out = json.load(urllib.request.urlopen(req, timeout=120))
    if "error" in out:
        raise RuntimeError(f"{method}: {out['error']}")
    return out["result"]


def show(title, value):
    print(f"\n-- {title} --")
    print(json.dumps(value, indent=2, default=str)[:6000])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("address")
    ap.add_argument("--revision", default="HEAD")
    ap.add_argument("--recon")
    ap.add_argument("--write-schema", action="store_true")
    args = ap.parse_args()

    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet

    client = create_client(chain=studionet, account=Account.create())   # read-only, never funded

    def view(fn, *a):
        return client.read_contract(address=args.address, function_name=fn, args=list(a))

    source = subprocess.run(["git", "show", f"{args.revision}:contracts/recon.py"], cwd=ROOT,
                            capture_output=True, check=True).stdout.replace(b"\r\n", b"\n")
    code = rpc("gen_getContractCode", [args.address])
    onchain = base64.b64decode(code)
    match = onchain == source
    print(f"on-chain  {args.address}  {len(onchain)} bytes  sha256 {hashlib.sha256(onchain).hexdigest()}")
    print(f"git       {args.revision:<42}  {len(source)} bytes  sha256 {hashlib.sha256(source).hexdigest()}")
    print("MATCH - the deployment is byte-identical to the repository source" if match
          else "DIFFER - the deployment is NOT the repository source")

    schema = rpc("gen_getContractSchema", [args.address])
    show("schema methods", {k: [p[0] for p in v.get("params", [])] + (["payable"] if v.get("payable") else [])
                            for k, v in sorted(schema.get("methods", {}).items())})
    show("get_protocol_info", view("get_protocol_info"))
    page = view("list_recons", 0, 50)
    show(f"list_recons(0, 50) - {page['total']} total",
         [{"recon_id": r["recon_id"], "status": r["status"], "current_state": r["current_state"],
           "results": r["result_count"], "bond": r["bond_status"]} for r in page["items"]])
    if args.recon:
        show(f"get_recon({args.recon})", view("get_recon", args.recon))
        show(f"get_results({args.recon})", view("get_results", args.recon, 0, 50))
        show(f"get_history({args.recon})", view("get_history", args.recon, 0, 50))

    if args.write_schema:
        out = ROOT / "lib" / "genlayer" / "recon-schema.json"
        out.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"\nschema written to {out.relative_to(ROOT)}")
    return 0 if match else 1


if __name__ == "__main__":
    sys.exit(main())
