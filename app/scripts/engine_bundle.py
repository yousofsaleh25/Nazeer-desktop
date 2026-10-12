r"""Copy the engine's runtime packages from the tested venv into the installer bundle (D11).

Run by ``scripts/stage-engine.mjs`` with the engine venv's interpreter::

    engine\.venv\Scripts\python.exe -I app\scripts\engine_bundle.py
        --requirements engine\requirements.txt --dest <bundle>\python\Lib\site-packages

The runtime set is every pin of ``engine/requirements.txt`` except the test tools, closed over
the installed distributions' requirements (markers evaluated for this interpreter, Windows and
Python 3.11; an extra only when a requirement asks for it). Every distribution in the closure
must be pinned at its installed version, and no build or test tool may be in it. Each file is
copied from the distribution's RECORD with its SHA-256 checked. Files outside site-packages
(console scripts), ``__pycache__`` (recompiled by the embedded interpreter) and the pruned paths
are left out. Prints one JSON summary on stdout; exit 1 with the reasons on stderr otherwise.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from dataclasses import asdict, dataclass, field
from importlib import metadata
from pathlib import Path, PurePosixPath

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name

# pinned in requirements.txt for the test suite only (requirements-dev.txt holds the rest)
TEST_PINS = frozenset({"pytest", "pluggy", "iniconfig", "pygments"})
# build, packaging and test tools: the installed engine never carries them
FORBIDDEN = frozenset({"pip", "setuptools", "wheel", "pytest", "ruff", "httpx2", "httpcore2"})
FORBIDDEN_TOP_LEVEL = frozenset(
    {"pip", "setuptools", "pkg_resources", "_distutils_hack", "pytest", "_pytest", "ruff"}
)
# declared requirements left out on purpose, with the reason (D11)
NOT_SHIPPED = {
    "setuptools": (
        "torch declares setuptools>=77.0.3 but imports it only in torch.utils.cpp_extension "
        "(building C++ extensions), which the engine never calls"
    ),
}
# C++ headers for building torch extensions: never used at runtime, and the deepest paths
PRUNE_PREFIXES = ("torch/include/",)
CHUNK = 1 << 20


class BundleError(Exception):
    pass


@dataclass
class CopiedDistribution:
    name: str
    version: str
    top_level: list[str]
    files: int = 0
    bytes: int = 0
    pruned_files: int = 0
    pruned_bytes: int = 0
    unhashed: list[str] = field(default_factory=list)
    not_shipped: list[str] = field(default_factory=list)


def read_pins(path: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        req = Requirement(line)
        specs = list(req.specifier)
        if len(specs) != 1 or specs[0].operator != "==":
            raise BundleError(f"not an exact pin in {path.name}: {line}")
        pins[canonicalize_name(req.name)] = specs[0].version
    return pins


def runtime_closure(
    roots: list[str], left_out: dict[str, list[str]] | None = None
) -> dict[str, metadata.Distribution]:
    """The installed distributions the roots need, with the extras requirements ask for.

    Requirements on a NOT_SHIPPED name are skipped and noted in ``left_out`` (name → the
    requirements that asked for it)."""
    found: dict[str, metadata.Distribution] = {}
    extras_seen: dict[str, set[str]] = {}
    queue: list[tuple[str, frozenset[str]]] = [(name, frozenset()) for name in roots]
    while queue:
        name, extras = queue.pop()
        seen = extras_seen.setdefault(name, set())
        if name in found and extras <= seen:
            continue
        if name not in found:
            try:
                found[name] = metadata.distribution(name)
            except metadata.PackageNotFoundError as exc:
                raise BundleError(f"{name} is needed but not installed in the venv") from exc
        seen.update(extras)
        environments = [{**default_environment(), "extra": extra} for extra in {"", *seen}]
        for text in found[name].requires or []:
            req = Requirement(text)
            if req.marker is not None and not any(req.marker.evaluate(env) for env in environments):
                continue
            needed = canonicalize_name(req.name)
            if needed in NOT_SHIPPED:
                if left_out is not None:
                    requirer = found[name].metadata["Name"]
                    left_out.setdefault(needed, []).append(f"{requirer}: {text}")
                continue
            queue.append((needed, frozenset(req.extras)))
    return found


def check_closure(closure: dict[str, metadata.Distribution], pins: dict[str, str]) -> list[str]:
    problems: list[str] = []
    for name, dist in sorted(closure.items()):
        if name in FORBIDDEN:
            problems.append(f"{name} is a build or test tool but the runtime closure needs it")
        pin = pins.get(name)
        if pin is None:
            problems.append(f"{name} {dist.version} is needed at runtime but not pinned")
        elif not SpecifierSet(f"=={pin}").contains(dist.version, prereleases=True):
            problems.append(f"{name}: installed {dist.version}, pinned {pin}")
    return problems


def copy_verified(src: Path, target: Path) -> tuple[str, int]:
    """Copy src to a new file; returns the RECORD-style SHA-256 of the bytes and the size."""
    digest = hashlib.sha256()
    size = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    with src.open("rb") as reader, target.open("xb") as writer:
        while chunk := reader.read(CHUNK):
            digest.update(chunk)
            writer.write(chunk)
            size += len(chunk)
    return base64.urlsafe_b64encode(digest.digest()).rstrip(b"=").decode("ascii"), size


def top_level_modules(dist: metadata.Distribution) -> list[str]:
    text = dist.read_text("top_level.txt")
    if text:
        return sorted({line.strip() for line in text.splitlines() if line.strip()})
    names: set[str] = set()
    for file in dist.files or []:
        parts = PurePosixPath(str(file).replace("\\", "/")).parts
        if not parts or parts[0] == ".." or parts[0].endswith((".dist-info", ".data")):
            continue
        if len(parts) == 1:
            stem = parts[0].split(".", 1)[0]
            if parts[0].endswith((".py", ".pyd")) and stem.isidentifier():
                names.add(stem)
        elif parts[0].isidentifier() and parts[0] != "__pycache__":
            names.add(parts[0])
    return sorted(names)


def copy_distribution(dist: metadata.Distribution, dest: Path) -> CopiedDistribution:
    copied = CopiedDistribution(dist.metadata["Name"], dist.version, top_level_modules(dist))
    for file in dist.files or []:
        rel = PurePosixPath(str(file).replace("\\", "/"))
        if rel.parts and rel.parts[0] == "..":
            copied.not_shipped.append(str(rel))  # console scripts in Scripts\
            continue
        if "__pycache__" in rel.parts:
            continue
        src = Path(str(file.locate()))
        if not src.is_file():
            raise BundleError(f"{dist.name}: {rel} is in RECORD but missing from the venv")
        if str(rel).startswith(PRUNE_PREFIXES):
            copied.pruned_files += 1
            copied.pruned_bytes += src.stat().st_size
            continue
        value, size = copy_verified(src, dest / rel)
        if file.hash is None:
            copied.unhashed.append(str(rel))  # the RECORD file itself
        elif file.hash.mode != "sha256":
            raise BundleError(f"{dist.name}: {rel} has a {file.hash.mode} RECORD hash")
        elif value != file.hash.value:
            raise BundleError(f"{dist.name}: {rel} does not match its RECORD hash")
        copied.files += 1
        copied.bytes += size
    return copied


def check_destination(dest: Path) -> list[str]:
    problems = [f"stray .pth file: {path.name}" for path in sorted(dest.glob("*.pth"))]
    for name in sorted(FORBIDDEN_TOP_LEVEL):
        if (dest / name).exists() or (dest / f"{name}.py").exists():
            problems.append(f"forbidden module in the bundle: {name}")
    for info in sorted(dest.glob("*.dist-info")):
        if canonicalize_name(info.name.split("-", 1)[0]) in FORBIDDEN:
            problems.append(f"forbidden distribution in the bundle: {info.name}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--requirements", required=True, type=Path)
    parser.add_argument("--dest", required=True, type=Path)
    args = parser.parse_args(argv)
    dest: Path = args.dest
    try:
        if dest.exists() and any(dest.iterdir()):
            raise BundleError(f"destination is not empty: {dest}")
        pins = read_pins(args.requirements)
        left_out: dict[str, list[str]] = {}
        closure = runtime_closure(sorted(set(pins) - TEST_PINS), left_out)
        problems = check_closure(closure, pins)
        if problems:
            raise BundleError("; ".join(problems))
        dest.mkdir(parents=True, exist_ok=True)
        copies = [copy_distribution(closure[name], dest) for name in sorted(closure)]
        problems = check_destination(dest)
        if problems:
            raise BundleError("; ".join(problems))
    except BundleError as exc:
        print(f"engine_bundle: {exc}", file=sys.stderr)
        return 1
    summary = {
        "python": sys.version.split()[0],
        "test_pins_left_out": sorted(TEST_PINS & set(pins)),
        "requirements_left_out": {
            name: {"reason": NOT_SHIPPED[name], "required_by": sorted(set(by))}
            for name, by in sorted(left_out.items())
        },
        "pruned_prefixes": list(PRUNE_PREFIXES),
        "files": sum(c.files for c in copies),
        "bytes": sum(c.bytes for c in copies),
        "pruned_bytes": sum(c.pruned_bytes for c in copies),
        "distributions": [asdict(c) for c in copies],
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
