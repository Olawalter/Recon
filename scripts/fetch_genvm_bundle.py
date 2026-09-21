"""Seed the GenVM runner bundle into the caches gltest and genvm-lint read.

Direct-mode tests need the GenVM runner bundle. On a machine whose caches are
empty — CI, or a fresh clone — `genlayer-test` asks for the release asset under
its old name, which the v0.3.0-rc line no longer publishes, and every direct
test errors at import. `genvm-linter` already tries both names, so the lint step
passes and only the test step fails, which makes the cause easy to misread.

Both tools cache at `~/.cache/{genvm-linter,gltest-direct}/genvm-universal-<ver>.tar.xz`
and both prefer a cached version over the newest release, so seeding that one
file fixes the tests and pins the runtime against an upstream retag.

    python scripts/fetch_genvm_bundle.py

Set GENVM_VERSION to seed a different release.
"""
import os
import pathlib
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

VERSION = os.environ.get("GENVM_VERSION", "v0.3.0-rc7")
RELEASE = "https://github.com/genlayerlabs/genvm/releases/download"
# Newest name first: the v0.3.0-rc line renamed the asset.
ASSETS = ("genvm-runners-all.tar.xz", "genvm-universal.tar.xz")
CACHES = (
    pathlib.Path.home() / ".cache" / "genvm-linter",
    pathlib.Path.home() / ".cache" / "gltest-direct",
)
NAME = f"genvm-universal-{VERSION}.tar.xz"


def usable(path: pathlib.Path) -> bool:
    """Both tools treat "the file exists" as "the file is good", so an
    interrupted download poisons the cache until it is deleted by hand."""
    if not path.exists():
        return False
    try:
        with tarfile.open(path) as archive:
            return archive.next() is not None
    except (tarfile.TarError, OSError):
        print(f"  {path} does not open; discarding it")
        path.unlink(missing_ok=True)
        return False


def download(into: pathlib.Path) -> pathlib.Path:
    last: Exception | None = None
    for asset in ASSETS:
        url = f"{RELEASE}/{VERSION}/{asset}"
        print(f"  fetching {url}")
        try:
            with urllib.request.urlopen(url) as response, open(into, "wb") as out:
                shutil.copyfileobj(response, out)
        except urllib.error.HTTPError as err:
            print(f"    {err.code} {err.reason}")
            last = err
            continue
        if not usable(into):
            last = RuntimeError(f"{asset} downloaded but does not open as an archive")
            continue
        print(f"  got {into.stat().st_size:,} bytes from {asset}")
        return into
    raise SystemExit(f"no usable bundle for {VERSION}: {last}")


def main() -> int:
    print(f"GenVM runner bundle {VERSION}")
    missing = [c for c in CACHES if not usable(c / NAME)]
    if not missing:
        print("  already cached in both locations")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        staged = download(pathlib.Path(tmp) / NAME)
        for cache in missing:
            cache.mkdir(parents=True, exist_ok=True)
            # Copy to the destination filesystem first, then rename, so a cache
            # never contains a half-written file under the real name.
            part = cache / (NAME + ".part")
            shutil.copyfile(staged, part)
            part.replace(cache / NAME)
            print(f"  seeded {cache / NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
