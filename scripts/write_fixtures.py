"""Write the interface's rendering fixtures from the live suite's record.

The interface tests render real results, not invented ones: each fixture is a
request and its result exactly as the live suite read them back from
StudioNet (docs/live-e2e.json).

    python scripts/write_fixtures.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIVE = json.loads((ROOT / "docs" / "live-e2e.json").read_text(encoding="utf-8"))
OUT = ROOT / "tests" / "frontend" / "fixtures" / "live-results.json"
CASES = ("majority", "derived", "grouped", "strict")


def main():
    fixtures = {
        "note": f"Real results recorded on GenLayer StudioNet by the live suite (run of {LIVE['finished_at'][:10]}), "
                f"contract {LIVE['contract']}. Written by scripts/write_fixtures.py; used as rendering fixtures.",
        "question": LIVE["question"],
    }
    for case in CASES:
        req = LIVE["requests"][case]
        fixtures[case] = {"recon": req["created"], "result": req["result"]}
    OUT.write_text(json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
