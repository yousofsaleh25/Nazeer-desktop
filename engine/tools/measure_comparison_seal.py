r"""Measure the comparison seal (D12 Stage 3): printed size, print time, seal time and the
engine's peak memory at 1, 5 and 20 camels, on real frames.

Each size gets its own data root under ``runs\comparison_seal_<UTC>\n<N>\``: the real
candidate frames of ``runs\dev_root`` are copied in, N sessions are measured (eight named
measurements each: 2D and 3D distances and curves, points on the camel's mask) and finalized,
so every overlay is engine-rendered from a real bag frame; a comparison of the N camels is
printed in Arabic with headless Microsoft Edge (Electron's Chromium printer; the app's own
page is Stage 5) and sealed through ``ComparisonStore.attach_report`` with the strict probes.
The seal runs in a fresh process, so its peak working set is the seal's own.

Run from ``engine\`` (about 1-2 minutes for 1, 5, 20):

    .venv\Scripts\python.exe tools\measure_comparison_seal.py
    .venv\Scripts\python.exe tools\measure_comparison_seal.py --sizes 20 --candidates <set dir>

Writes ``summary.json`` and prints one line per size. A development tool: it imports the test
helpers (``tests.chromium``) for the print page and Edge.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ENGINE_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ENGINE_DIR.parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

NAMES = (
    ("distance_3d", "طول الجسم", 2),
    ("distance_3d", "ارتفاع السنام", 2),
    ("distance_2d", "ارتفاع الكتف", 2),
    ("curve_3d", "محيط الصدر", 4),
    ("curve_2d", "خط الظهر", 5),
    ("distance_3d", "طول الرقبة", 2),
    ("distance_2d", "Hump height 2D", 2),
    ("curve_3d", "Belly line", 4),
)


def _candidate_set(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit)
    sets = [
        p.parent
        for p in (PROJECT_DIR / "runs" / "dev_root" / "candidates").glob("*/*/candidates.json")
    ]
    if not sets:
        raise SystemExit("no candidate set under runs\\dev_root\\candidates (run the app once)")
    return max(sets, key=lambda p: len([c for c in p.iterdir() if c.is_dir()]))


def _measurements(mask_path: Path, seed: int) -> list[dict[str, Any]]:
    import numpy as np

    from nazeer_engine import fsio

    mask = fsio.read_image(mask_path, flags=0)
    ys, xs = np.nonzero(mask > 127)
    rng = np.random.default_rng(seed)
    out = []
    for index, (kind, name, n_points) in enumerate(NAMES, start=1):
        picks = rng.choice(len(xs), size=n_points, replace=False)
        points = sorted(([int(xs[i]), int(ys[i])] for i in picks), key=lambda p: p[0])
        out.append({"id": index, "kind": kind, "name": name, "points": points})
    return out


def build(n: int, workdir: Path, candidate_set: Path) -> dict[str, Any]:
    """Data root, N finalized sessions, the comparison, the Edge print."""
    from nazeer_engine import fsio
    from nazeer_engine.comparison_store import ComparisonStore
    from nazeer_engine.history import HistoryIndex
    from nazeer_engine.jsonsafe import loads_strict
    from nazeer_engine.session_store import SessionStore
    from tests.chromium import comparison_page, print_to_pdf

    root = workdir / "root"
    target = root / "candidates" / candidate_set.parent.name / candidate_set.name
    shutil.copytree(candidate_set, target)
    history = HistoryIndex(root / "history.sqlite")
    sessions = SessionStore(root, history)
    comparisons = ComparisonStore(root, history, sessions)
    ids = sorted(c.name for c in target.iterdir() if c.is_dir())
    started = time.perf_counter()
    session_ids = []
    for k in range(1, n + 1):
        candidate_id = ids[(k - 1) % len(ids)]
        ref = {
            "fingerprint": candidate_set.parent.name,
            "params_hash": candidate_set.name,
            "candidate_id": candidate_id,
        }
        camel = f"جمل-{k}"
        doc, _ = sessions.create(ref, camel_id=camel)
        measurements = _measurements(target / candidate_id / "mask.png", seed=k)
        sessions.save_document(doc.session_id, 1, {"camel_id": camel, "measurements": measurements})
        sessions.finalize(doc.session_id, 1)
        session_ids.append(doc.session_id)
    sessions_s = time.perf_counter() - started
    record, _ = comparisons.create(
        session_ids,
        cover={
            "title": "نهائي المزاين",
            "event": "مهرجان الإبل",
            "judge": "الحكم",
            "council": "مجلس",
        },
        language="ar",
    )
    cid = record["comparison_id"]
    cdir = comparisons.comparison_dir(cid)
    model = loads_strict(fsio.read_bytes(cdir / record["outputs"]["model_file"]))
    overlays = {
        sid: fsio.read_bytes(sessions.session_dir(sid) / "overlay_v1.png") for sid in session_ids
    }
    page = comparison_page(model, overlays)
    started = time.perf_counter()
    printed = print_to_pdf(page, workdir / "print", timeout=600)
    print_s = time.perf_counter() - started
    if printed is None:
        raise SystemExit("Edge printed nothing")
    pdf = workdir / "printed.pdf"
    pdf.write_bytes(printed)
    return {
        "n": n,
        "root": str(root),
        "comparison_id": cid,
        "model_sha256": record["outputs"]["model_sha256"],
        "pdf": str(pdf),
        "overlay_bytes": sum(len(b) for b in overlays.values()),
        "page_html_bytes": len(page.encode("utf-8")),
        "printed_bytes": len(printed),
        "sessions_s": round(sessions_s, 2),
        "print_s": round(print_s, 2),
    }


def seal(root: Path, comparison_id: str, model_sha256: str, pdf: Path) -> dict[str, Any]:
    """The seal alone, in this fresh process (its peak working set is the seal's)."""
    import psutil

    from nazeer_engine.comparison_store import ComparisonStore
    from nazeer_engine.history import HistoryIndex
    from nazeer_engine.session_store import SessionStore

    process = psutil.Process()
    history = HistoryIndex(root / "history.sqlite")
    sessions = SessionStore(root, history)
    comparisons = ComparisonStore(root, history, sessions)
    import numpy  # noqa: F401  (imports done before the baseline)
    import pypdf  # noqa: F401
    from PIL import Image  # noqa: F401

    data = pdf.read_bytes()
    baseline = process.memory_info()
    started = time.perf_counter()
    record, probe = comparisons.attach_report(
        comparison_id, data, expected_model_sha256=model_sha256
    )
    seal_s = time.perf_counter() - started
    after = process.memory_info()
    return {
        "verdict": probe["verdict"],
        "hard_failures": probe["hard_failures"],
        "soft_failures": probe["soft_failures"],
        "n_pages": probe["n_pages"],
        "overlay_pages": [m["page"] for m in probe["pixel"]["members"]],
        "n_decoded": probe["pixel"]["n_decoded"],
        "sealed_bytes": probe["bytes_out"],
        "seal_s": round(seal_s, 2),
        "timings_ms": probe["timings_ms"],
        "baseline_wset_mb": round(baseline.wset / 2**20, 1),
        "peak_wset_mb": round(after.peak_wset / 2**20, 1),
        "status": record["status"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sizes", default="1,5,20")
    parser.add_argument(
        "--candidates", help="a candidate set dir (default: the dev root's largest)"
    )
    parser.add_argument("--out", help="output dir (default: runs\\comparison_seal_<UTC>)")
    parser.add_argument("--child-build", nargs=2, metavar=("N", "WORKDIR"), help=argparse.SUPPRESS)
    parser.add_argument("--child-seal", nargs=4, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.child_build:
        n, workdir = int(args.child_build[0]), Path(args.child_build[1])
        result = build(n, workdir, _candidate_set(args.candidates))
        print(json.dumps(result))
        return 0
    if args.child_seal:
        root, cid, sha, pdf = args.child_seal
        print(json.dumps(seal(Path(root), cid, sha, Path(pdf))))
        return 0
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%SZ")
    out = Path(args.out) if args.out else PROJECT_DIR / "runs" / f"comparison_seal_{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for n in (int(x) for x in args.sizes.split(",")):
        workdir = out / f"n{n}"
        workdir.mkdir()
        extra = ["--candidates", args.candidates] if args.candidates else []
        built = json.loads(
            subprocess.run(
                [sys.executable, __file__, "--child-build", str(n), str(workdir), *extra],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            .stdout.strip()
            .splitlines()[-1]
        )
        sealed = json.loads(
            subprocess.run(
                [
                    sys.executable,
                    __file__,
                    "--child-seal",
                    built["root"],
                    built["comparison_id"],
                    built["model_sha256"],
                    built["pdf"],
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            .stdout.strip()
            .splitlines()[-1]
        )
        row = {**built, **sealed}
        rows.append(row)
        print(
            f"n={n:>2}  pages={row['n_pages']:>3}  printed={row['printed_bytes'] / 1e6:6.1f} MB  "
            f"sealed={row['sealed_bytes'] / 1e6:6.1f} MB  print={row['print_s']:6.1f} s  "
            f"seal={row['seal_s']:6.1f} s  peak={row['peak_wset_mb']:7.1f} MB  {row['verdict']}",
            flush=True,
        )
    (out / "summary.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), "utf-8")
    print(f"summary: {out / 'summary.json'}")
    return 0 if all(r["verdict"] == "PASS" for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
