"""Probe candidate evidence sources the way the contract will read them.

For each URL: fetch it, apply the contract's own text extraction and excerpt
cap, and report the status, Last-Modified, the excerpt length, and whether the
expected passages appear inside what the validator panel will actually see.
Run before choosing live-suite sources: a fact below the excerpt cap does not
exist for the panel.

    python scripts/probe_sources.py <url> [<needle> ...]
"""
import ast
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts" / "recon.py"


def _lift(names):
    """Execute the contract's own pure helpers, lifted by AST, so the probe
    reads a page exactly as the contract does."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in names) or
            (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets))]
    ns = {"re": __import__("re"), "json": __import__("json"), "datetime": __import__("datetime")}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(SOURCE), "exec"), ns)
    return ns


H = _lift({"_decode_body", "_extract_text", "_sanitize", "_squash", "_dates_in", "_iso", "_http_date",
           "FENCE", "MONTHS", "MAX_EXCERPT_CHARS", "MAX_RESPONSE_BYTES"})


def main() -> int:
    url, needles = sys.argv[1], sys.argv[2:]
    req = urllib.request.Request(url, headers={"User-Agent": "RECON-GenLayer/1.0",
                                               "Accept": "text/html, application/json;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as r:
        status, body, modified = r.status, r.read(), r.headers.get("Last-Modified")
    decoded = H["_decode_body"](body)
    if decoded is None:
        print(f"{status}  {len(body):,} bytes: UNREADABLE (the panel would record UNAVAILABLE)")
        return 1
    excerpt = H["_sanitize"](H["_extract_text"](decoded), H["MAX_EXCERPT_CHARS"])
    print(f"{status}  {len(body):,} bytes  Last-Modified: {modified} -> {H['_http_date'](modified or '')!r}")
    print(f"excerpt {len(excerpt):,} chars; dates stated: {H['_dates_in'](excerpt)[:12]}")
    for n in needles:
        pos = H["_squash"](excerpt).find(H["_squash"](n))
        print(f"  {'FOUND' if pos >= 0 else 'absent'} at {pos:>5}: {n!r}")
    print("  head:", excerpt[:300].replace("\n", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
