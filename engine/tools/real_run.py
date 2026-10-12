r"""Real-bag check: drive the engine sidecar over HTTP the way the Electron app will.

bag -> candidate walk -> the proposed frames saved under runs/ -> pick one -> random distances
(2D and 3D lines and curves; ``--angles`` adds two angles) -> hover probes, drag previews and
autosaves -> finalize (overlay PNG) -> print page in headless Microsoft Edge (Electron's
Chromium printer) -> upload with strict probes -> the sealed PDF.

Run from ``engine\`` with the engine venv (about 1-2 minutes: model load, walk, print):

    .venv\Scripts\python.exe tools\real_run.py
    .venv\Scripts\python.exe tools\real_run.py --bag ..\data\.bag\20260414_180708-004.bag --seed 7

Everything lands in ``runs\real_run_<UTC stamp>\``:

* ``data_root\`` - the engine's own data root (``candidates\``, ``sessions\``,
  ``history.sqlite``, ``logs\``): what the app's ``userData`` will hold;
* ``candidates\`` - every proposed frame fetched through the API, ``contact_sheet.jpg``;
* ``print\`` - the print page and the raw ``printed.pdf``;
* ``final_report.pdf`` (the sealed PDF from ``GET /sessions/{id}/report``),
  ``overlay_vN.png``, ``report_model_vN.json``, ``report.manifest.json``, ``summary.json``.

The client speaks HTTP only and never imports ``nazeer_engine``. Its print page stands in
for the app's React print page and is laid out from ``report_model.json`` alone; its first
page says the measurements are random (a test run, not a judging record). Exit code 0 means
every check passed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
import math
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import Message
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fontTools.ttLib import TTFont
from pypdf import PdfReader

ENGINE_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = ENGINE_DIR.parent
DEFAULT_BAG = PROJECT_DIR / "data" / ".bag" / "20260414_175757-006.bag"
ASSETS_DIR = ENGINE_DIR / "nazeer_engine" / "assets"
FONT_PATH = ASSETS_DIR / "fonts" / "IBMPlexSansArabic-Regular.ttf"
LOGO_PATH = ASSETS_DIR / "logo.png"
EDGE_PATHS = (
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
    / "Microsoft/Edge/Application/msedge.exe",
)
CLIENT_VERSION = "real_run/1"
A4_PT = (595.28, 841.89)
TILE_W, TILE_H = 400, 225

TEST_BANNER = {
    "ar": "تشغيل تجريبي: قياسات عشوائية على إطار حقيقي، وليس سجل تحكيم.",
    "en": "Test run: random measurements on a real frame. Not a judging record.",
}
REJECTED = {"ar": "مرفوض", "en": "Rejected"}  # console only; the page reads static.rejected
NAMES = {  # (Arabic, English); odd ids get the Arabic name, even ids the English one
    "distance_2d": ("مسافة ثنائية الأبعاد {n}", "Random 2D distance {n}"),
    "distance_3d": ("مسافة ثلاثية الأبعاد {n}", "Random 3D distance {n}"),
    "ground": ("من الخف إلى الأرض", "Hoof to ground"),
    "curve_2d": ("منحنى ثنائي الأبعاد {n}", "Random 2D curve {n}"),
    "curve_3d": ("منحنى ثلاثي الأبعاد {n}", "Random 3D curve {n}"),
    "angle": ("زاوية {n}", "Random angle {n}"),
}
INSIDE_SOURCES = ("window_median", "knn_fill")
OUTSIDE_SOURCES = ("knn_snapped_to_mask", "knn_no_depth_band")


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def num(value: Any, spec: str) -> str:
    return "--" if value is None else format(value, spec)


def strict_json(data: bytes) -> Any:
    """The engine never sends NaN / Infinity (finite-only contract): treat one as a failure."""

    def reject(token: str) -> Any:
        raise ValueError(f"non-finite JSON token {token!r} on the wire")

    return json.loads(data, parse_constant=reject)


class CheckFailed(RuntimeError):
    """The run cannot go on; summary.json still records how far it got."""


# ----- HTTP client ---------------------------------------------------------------------------


@dataclass
class Reply:
    status: int
    headers: Message
    body: bytes

    def json(self) -> Any:
        return strict_json(self.body)


class ApiError(CheckFailed):
    def __init__(self, op: str, method: str, path: str, status: int, body: bytes) -> None:
        self.status = status
        self.error: dict[str, Any] = {}
        try:
            self.error = strict_json(body).get("error") or {}
        except ValueError:
            pass
        what = self.error.get("code") or body[:300].decode("utf-8", "replace")
        super().__init__(f"{op}: {method} {path} -> {status} {what}: {self.error.get('message')}")


@dataclass
class Api:
    """Plain urllib against 127.0.0.1 (no proxy): the calls the React + Redux client makes."""

    base: str
    token: str
    app_headers: dict[str, str] = field(default_factory=dict)
    calls: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(
        self,
        op: str,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        expect: tuple[int, ...] = (200,),
        timeout: float = 120.0,
    ) -> Reply:
        url = self.base + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        sent = {"X-Nazeer-Token": self.token, **self.app_headers}
        data = None
        if json_body is not None:
            data = json.dumps(json_body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            sent["Content-Type"] = "application/json"
        elif body is not None:
            data = body
        sent.update(headers or {})
        request = urllib.request.Request(url, data=data, method=method, headers=sent)
        t0 = time.perf_counter()
        try:
            with self._opener.open(request, timeout=timeout) as resp:
                status, rheaders, payload = resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as exc:
            status, rheaders, payload = exc.code, exc.headers, exc.read()
        self.calls.append(
            {
                "op": op,
                "method": method,
                "status": status,
                "ms": round((time.perf_counter() - t0) * 1000, 1),
                "bytes": len(payload),
            }
        )
        if status not in expect:
            raise ApiError(op, method, path, status, payload)
        return Reply(status, rheaders, payload)

    def get_bytes(self, op: str, path: str) -> bytes:
        return self.call(op, "GET", path).body


# ----- the sidecar ---------------------------------------------------------------------------


class Engine:
    """Spawned and supervised like Electron will: one ASCII ready line on stdout, logs on
    stderr (kept in ``engine.stderr.log``), ``POST /system/shutdown`` to stop."""

    def __init__(self, data_root: Path, token: str, stderr_path: Path) -> None:
        self.data_root = data_root
        self.token = token
        self.stderr_path = stderr_path
        self.proc: subprocess.Popen[bytes] | None = None
        self.ready: dict[str, Any] = {}
        self.stdout_noise: list[str] = []
        self._stderr: Any = None

    def start(self, timeout: float = 240.0) -> dict[str, Any]:
        cmd = [
            sys.executable,
            "-m",
            "nazeer_engine",
            "--data-root",
            str(self.data_root),
            "--port",
            "0",
            f"--token={self.token}",
        ]
        self._stderr = self.stderr_path.open("wb")
        self.proc = subprocess.Popen(
            cmd,
            cwd=ENGINE_DIR,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=self._stderr,
        )
        lines: queue.Queue[bytes] = queue.Queue()
        stdout = self.proc.stdout
        assert stdout is not None

        def pump() -> None:
            for line in stdout:
                lines.put(line)

        threading.Thread(target=pump, daemon=True).start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                raw = lines.get(timeout=0.5)
            except queue.Empty:
                if self.proc.poll() is not None:
                    raise CheckFailed(
                        f"engine exited ({self.proc.returncode}) before its ready line; "
                        f"see {self.stderr_path}"
                    ) from None
                continue
            try:
                event = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                event = None
            if not isinstance(event, dict):  # the contract is one JSON line; note anything else
                self.stdout_noise.append(raw.decode("utf-8", "replace").rstrip())
                continue
            if event.get("event") == "ready":
                self.ready = event
                return event
            if event.get("event") == "fatal":
                raise CheckFailed(f"engine fatal {event.get('code')}: {event.get('message')}")
        raise CheckFailed(f"no ready line within {timeout:.0f} s")

    def stop(self, api: Api | None) -> int | None:
        if self.proc is None:
            return None
        if self.proc.poll() is None and api is not None:
            try:
                api.call("shutdown_engine", "POST", "/system/shutdown", expect=(202,))
            except Exception as exc:
                print(f"    shutdown request failed ({exc}); killing the process")
        try:
            code = self.proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            code = self.proc.wait(timeout=10)
        if self._stderr is not None:
            self._stderr.close()
        return code


# ----- random clicks on the real mask --------------------------------------------------------


class Clicks:
    """Seeded random clicks placed the way an operator's land: sub-pixel floats that round
    (half-up, B32) to the intended pixel."""

    INSET_PX = 6  # "inside" clicks keep >= 6 px from the silhouette (C1 erodes 2 px)
    OUTSIDE_PX = (8.0, 25.0)  # "missed the camel" clicks land 8-25 px outside it

    def __init__(self, mask: np.ndarray, ground_row: int, rng: np.random.Generator) -> None:
        self.mask = mask
        self.h, self.w = mask.shape
        self.ground_row = ground_row
        self.rng = rng
        k = 2 * self.INSET_PX + 1
        self.core = cv2.erode(mask.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
        ys, xs = np.nonzero(self.core)
        if len(xs) == 0:
            raise CheckFailed("the mask has no pixel 6 px inside its silhouette")
        self.inside_px = np.stack([xs, ys], axis=1)
        self.outside_dist = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5)
        lo, hi = self.OUTSIDE_PX
        ys, xs = np.nonzero((self.outside_dist >= lo) & (self.outside_dist <= hi))
        self.outside_px = np.stack([xs, ys], axis=1)

    def _click(self, xy: Any) -> list[float]:
        jx, jy = (float(v) for v in self.rng.uniform(-0.45, 0.45, size=2))
        return [round(float(xy[0]) + jx, 2), round(float(xy[1]) + jy, 2)]

    def inside(self) -> list[float]:
        return self._click(self.inside_px[self.rng.integers(len(self.inside_px))])

    def outside(self) -> tuple[list[float], float]:
        xy = self.outside_px[self.rng.integers(len(self.outside_px))]
        return self._click(xy), float(self.outside_dist[xy[1], xy[0]])

    def pair(self, min_px: float) -> list[list[float]]:
        for _ in range(5000):
            a, b = self.inside(), self.inside()
            if math.dist(a, b) >= min_px:
                return [a, b]
        raise CheckFailed(f"no two mask points {min_px:.0f} px apart")

    def curve(self, n: int = 5, min_span: float = 260.0, wobble: float = 40.0) -> list[list[float]]:
        a, b = sorted(self.pair(min_span))  # left to right
        length = math.dist(a, b)
        nx, ny = -(b[1] - a[1]) / length, (b[0] - a[0]) / length
        points = [a]
        for t in np.linspace(0.0, 1.0, n)[1:-1]:
            bx, by = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
            for _ in range(200):
                off = float(self.rng.uniform(-wobble, wobble))
                x = int(math.floor(bx + off * nx + 0.5))
                y = int(math.floor(by + off * ny + 0.5))
                if 0 <= x < self.w and 0 <= y < self.h and self.core[y, x]:
                    points.append(self._click((x, y)))
                    break
            else:  # the core pixel nearest the straight path
                d = np.hypot(self.inside_px[:, 0] - bx, self.inside_px[:, 1] - by)
                points.append(self._click(self.inside_px[int(np.argmin(d))]))
        points.append(b)
        return points

    def hoof_and_ground(self, gap_px: float = 15.0) -> tuple[list[list[float]], float] | None:
        """A point on the lowest 30 rows of the camel and a Shift-click ground point outside
        it, >= ``gap_px`` from the silhouette, near the drawn ground row."""
        hoof_core = cv2.erode(self.mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        ys, xs = np.nonzero(hoof_core)
        if len(ys) == 0:
            return None
        low = ys >= ys.max() - 30
        hoofs = np.stack([xs[low], ys[low]], axis=1)
        hoof = hoofs[self.rng.integers(len(hoofs))]
        y0, y1 = max(0, self.ground_row - 12), min(self.h - 1, self.ground_row + 40)
        gy, gx = np.nonzero(self.outside_dist[y0 : y1 + 1] >= gap_px)
        near = np.abs(gx - int(hoof[0])) <= 150
        if not near.any():
            return None
        options = np.stack([gx[near], gy[near] + y0], axis=1)
        ground = options[self.rng.integers(len(options))]
        gap = float(self.outside_dist[ground[1], ground[0]])
        return [self._click(hoof), self._click(ground)], gap


@dataclass
class Planned:
    item: dict[str, Any]  # the MeasurementInputModel body
    roles: list[str]  # per point: inside | outside | hoof | ground (client-side expectation)


def plan_measurements(clicks: Clicks, *, n_each: int, angles: bool) -> list[Planned]:
    planned: list[Planned] = []
    counts: Counter[str] = Counter()

    def add(key: str, kind: str, points: list[list[float]], roles: list[str], **extra: Any) -> int:
        counts[key] += 1
        mid = len(planned) + 1
        ar, en = NAMES[key]
        item: dict[str, Any] = {
            "id": mid,
            "kind": kind,
            "name": (ar if mid % 2 else en).format(n=counts[key]),
            "points": points,
        }
        item.update(extra)
        planned.append(Planned(item, roles))
        return mid

    both_inside = "random clicks, both inside the camel"
    in_in = ["inside", "inside"]
    for _ in range(n_each):
        add("distance_2d", "distance_2d", clicks.pair(120), in_in, note=both_inside)
    for i in range(n_each):
        if i == n_each - 1 and len(clicks.outside_px):
            outside, gap = clicks.outside()
            note = f"random; P2 is {gap:.0f} px outside the camel (operator rule: KNN depth)"
            points = [clicks.inside(), outside]
            add("distance_3d", "distance_3d", points, ["inside", "outside"], note=note)
        else:
            add("distance_3d", "distance_3d", clicks.pair(120), in_in, note=both_inside)
    ground = clicks.hoof_and_ground()
    if ground is not None:
        points, gap = ground
        note = f"random hoof point; P2 is a Shift-click ground point {gap:.0f} px from the camel"
        targets = ["camel", "ground"]
        add("ground", "distance_3d", points, ["hoof", "ground"], targets=targets, note=note)
    curve = clicks.curve()
    inside = ["inside"] * len(curve)
    c2 = add("curve_2d", "curve_2d", curve, inside, note="5 random control points inside the camel")
    note = f"the same control points as #{c2}"
    add("curve_3d", "curve_3d", [list(p) for p in curve], inside, note=note)
    if angles:
        lines_2d = [p.item["id"] for p in planned if p.item["kind"] == "distance_2d"][:2]
        if len(lines_2d) == 2:
            a, b = lines_2d
            note = f"between #{a} and #{b}"
            add("angle", "angle_4point", [], [], line_a_id=a, line_b_id=b, note=note)
        tri = [clicks.inside(), clicks.inside(), clicks.inside()]
        note = "vertex first; 3 random points inside the camel"
        add("angle", "angle_3d_3point", tri, ["inside"] * 3, note=note)
    return planned


# ----- the proposed frames -------------------------------------------------------------------


def decode_bgr(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise CheckFailed("an image from the API did not decode")
    return image


def decode_mask(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise CheckFailed("a mask from the API did not decode")
    return image != 0


def candidate_tile(bgr: np.ndarray, mask: np.ndarray, lines: list[str], picked: bool) -> np.ndarray:
    tile = cv2.resize(bgr, (TILE_W, TILE_H), interpolation=cv2.INTER_AREA)
    small = cv2.resize(
        mask.astype(np.uint8) * 255, (TILE_W, TILE_H), interpolation=cv2.INTER_NEAREST
    )
    contours, _ = cv2.findContours(small, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(tile, contours, -1, (90, 230, 90), 1, cv2.LINE_AA)
    band = np.zeros((42, TILE_W, 3), np.uint8)
    for i, text in enumerate(lines):
        org = (6, 16 + 18 * i)
        cv2.putText(
            band, text, org, cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA
        )
    tile = np.vstack([tile, band])
    if picked:
        cv2.rectangle(tile, (1, 1), (TILE_W - 2, tile.shape[0] - 2), (0, 150, 255), 4)
    return tile


def contact_sheet(tiles: list[np.ndarray], cols: int = 4, pad: int = 8) -> np.ndarray:
    th, tw = tiles[0].shape[:2]
    rows = math.ceil(len(tiles) / cols)
    width = min(cols, len(tiles)) * (tw + pad) + pad
    sheet = np.full((rows * (th + pad) + pad, width, 3), 255, np.uint8)
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        y, x = pad + r * (th + pad), pad + c * (tw + pad)
        sheet[y : y + th, x : x + tw] = tile
    return sheet


def pick_candidate(cands: list[dict[str, Any]], how: str) -> dict[str, Any]:
    """``auto`` = the steadiest SIDE frame (lowest depth MSE), else the steadiest of all;
    ``N`` = tile N of the contact sheet (time order); ``cXX_XXXXXX`` = that candidate."""
    by_time = sorted(cands, key=lambda c: c["read_index"])
    if how == "auto":
        side = [c for c in cands if c.get("bucket") == "SIDE" and c.get("z_var") is not None]
        pool = side or [c for c in cands if c.get("z_var") is not None] or by_time
        return min(
            pool,
            key=lambda c: (c["z_var"] if c.get("z_var") is not None else math.inf, c["read_index"]),
        )
    if how.isdigit() and 1 <= int(how) <= len(by_time):
        return by_time[int(how) - 1]
    for cand in cands:
        if cand["candidate_id"] == how:
            return cand
    raise CheckFailed(f"--pick {how!r}: no such candidate (1..{len(cands)} or a candidate id)")


# ----- the print page (stand-in for the app's React print page) ------------------------------

CSS = """
@font-face { font-family: "Plex Arabic"; src: url(data:font/ttf;base64,__FONT__)
  format("truetype"); font-weight: 400; font-style: normal; }
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; font-weight: 400 !important; font-style: normal !important; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Plex Arabic"; font-size: 8.6pt; line-height: 1.45;
  color: #1f1a17; }
header { display: flex; align-items: center; gap: 12px; padding-bottom: 6px;
  border-bottom: 2px solid #a8642a; }
header .logo { height: 46px; }
.brand { font-size: 17pt; color: #8a4b12; line-height: 1.2; }
.title { font-size: 12pt; }
.cert { font-size: 7.5pt; color: #6b5b4b; }
.banner { margin: 8px 0 4px; padding: 5px 9px; border: 1.5px dashed #b3261e;
  color: #b3261e; background: #fff4f2; }
h2 { font-size: 10.5pt; color: #8a4b12; margin: 12px 0 4px; padding-bottom: 2px;
  border-bottom: 1px solid #e6cfb3; break-after: avoid; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #dcc7ab; padding: 3px 5px; vertical-align: top; text-align: start; }
th { background: #f7eee2; color: #4a3b2c; }
table.kv th { width: 28%; }
tr { break-inside: avoid; }
.en { color: #5c5047; }
.sep { color: #a08a74; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.small { font-size: 7.4pt; color: #6b5b4b; }
.nowrap { white-space: nowrap; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px;
  vertical-align: middle; }
.chip { display: inline-block; margin: 1px 0; padding: 0 4px; border-radius: 3px;
  border: 1px solid #c58b4a; color: #8a4b12; font-size: 7.2pt; }
.chip.warn { border-color: #b3261e; color: #b3261e; }
.rejected { color: #b3261e; }
figure.camel { margin: 6px 0 0; break-inside: avoid; }
figure.camel img { display: block; width: 100%; border: 1px solid #dcc7ab; }
.page { break-before: page; }
.blank { height: 15px; border-bottom: 1px solid #b9a58e; }
.wells { display: flex; gap: 12px; margin-top: 6px; break-inside: avoid; }
.well { flex: 1; border: 1px solid #dcc7ab; padding: 6px 8px; }
.well .sign { height: 54px; border-bottom: 1px solid #b9a58e; margin: 6px 0; }
footer { margin-top: 10px; padding-top: 4px; border-top: 1px solid #e6cfb3; }
"""


class PrintPage:
    """Lays out ``report_model.json`` and nothing else (ADR-D7: the engine computes, the page
    only typesets). One embedded face (IBM Plex Sans Arabic Regular) and no bold or italic
    anywhere: a synthesized face would put names into unsearchable Type3 glyphs (B38)."""

    def __init__(self, model: dict[str, Any], *, report_model_sha256: str) -> None:
        self.m = model
        self.st = model["static"]
        self.lang = model["inputs"]["language"]
        self.report_model_sha256 = report_model_sha256
        self.texts: list[str] = []  # every string drawn, for the glyph-coverage check

    def esc(self, value: Any) -> str:
        text = "" if value is None else str(value)
        self.texts.append(text)
        return html.escape(text)

    def ltr(self, value: Any) -> str:
        return f'<span class="ltr" dir="ltr">{self.esc(value)}</span>'

    def auto(self, value: Any, *, block: bool = False, cls: str = "") -> str:
        """Operator-typed text: its own direction from its first strong character, isolated
        from the page's RTL flow (an English note starting with a digit is not reordered)."""
        tag = "div" if block else "bdi"
        attr = f' class="{cls}"' if cls else ""
        return f'<{tag}{attr} dir="auto">{self.esc(value)}</{tag}>'

    def bi(self, label: dict[str, Any] | None, *, block: bool = False) -> str:
        """An engine label, each language in its own bidi isolate so the halves never mix."""
        if not label:
            return ""
        ar = f'<span class="ar" lang="ar" dir="rtl">{self.esc(label.get("ar", ""))}</span>'
        en = f'<span class="en" lang="en" dir="ltr">{self.esc(label.get("en", ""))}</span>'
        if self.lang == "ar":
            return ar
        if self.lang == "en":
            return en
        return ar + ("<br>" if block else f'<span class="sep">{self.esc(" · ")}</span>') + en

    def _point(self, point: Any) -> str:
        if point is None:
            return ""
        return self.ltr(f"P{point}" if isinstance(point, int) else str(point)) + " "

    def _chip(self, chip: dict[str, Any]) -> str:
        warn = " warn" if chip.get("severity") == "warn" else ""
        return f'<span class="chip{warn}">{self.bi(chip, block=True)}</span> '

    def _basis(self, entries: list[dict[str, Any]]) -> str:
        """Per-point depth basis; consecutive points with the same text share one line
        (a 2D row reads "P1-P5 Z_ref 2.329 m" once, not five times)."""
        groups: list[tuple[list[Any], dict[str, Any]]] = []
        for entry in entries:
            if groups and (groups[-1][1].get("ar"), groups[-1][1].get("en")) == (
                entry.get("ar"),
                entry.get("en"),
            ):
                groups[-1][0].append(entry.get("point"))
            else:
                groups.append(([entry.get("point")], entry))
        out = []
        for points, entry in groups:
            first, last = points[0], points[-1]
            label = first if len(points) == 1 or first is None else f"P{first}-P{last}"
            out.append(f"<div>{self._point(label)}{self.bi(entry)}</div>")
        return "".join(out)

    def header(self, logo_png: bytes | None) -> str:
        st = self.st
        logo = ""
        if logo_png:
            logo = f'<img class="logo" src="data:image/png;base64,{b64(logo_png)}" alt="">'
        cert = "".join(
            f"<div>{self.bi({'ar': ar, 'en': en})}</div>"
            for ar, en in zip(st["certification"]["ar"], st["certification"]["en"], strict=True)
        )
        return (
            f'<header>{logo}<div><div class="brand">{self.bi(st["brand"])}</div>'
            f'<div class="title">{self.bi(st["title"])}</div><div class="cert">{cert}</div>'
            f"</div></header>"
        )

    def session_table(self) -> str:
        s, f, st = self.m["session"], self.m["frame"], self.st
        labels = st["session_rows"]
        source = f"{self.auto(f.get('bag_name'))}{self.esc(' · ')}{self.bi(f['texts']['source'])}"
        rows = [
            ("session_id", self.ltr(s["session_id"])),
            ("operator", self.auto(s.get("operator"), block=True)),
            ("camel_id", self.auto(s.get("camel_id"), block=True)),
            ("event", self.auto(self.m["inputs"]["names"].get("event"), block=True)),
            ("n_measurements", self.ltr(self.m["summary"]["n_measurements"])),
            ("source_frame", source),
            ("generated", self.ltr(self.m["generated_at"])),
        ]
        body = "".join(f"<tr><th>{self.bi(labels[k])}</th><td>{v}</td></tr>" for k, v in rows)
        if s.get("notes"):
            label = self.bi(st["columns"]["notes"])
            body += f"<tr><th>{label}</th><td>{self.auto(s['notes'], block=True)}</td></tr>"
        return f'<h2>{self.bi(st["headings"]["session"])}</h2><table class="kv">{body}</table>'

    def frame_table(self) -> str:
        # report model 1.1: the labels are static content, the texts are formatted by the engine
        texts = self.m["frame"]["texts"]
        body = "".join(
            f"<tr><th>{self.bi(label)}</th><td>{self.bi(texts[key], block=True)}</td></tr>"
            for key, label in self.st["frame_rows"].items()
        )
        heading = self.st["headings"]["depth"]
        return f'<h2>{self.bi(heading)}</h2><table class="kv">{body}</table>'

    def camel_view(self, overlay_png: bytes) -> str:
        ov = self.m["overlay"]
        caption = (
            f"{ov.get('file')} - {ov.get('width')} x {ov.get('height')} px - "
            f"sha256 {ov.get('sha256')}"
        )
        return (
            f'<h2>{self.bi(self.st["headings"]["camel_view"])}</h2><figure class="camel">'
            f'<img src="data:image/png;base64,{b64(overlay_png)}" alt="">'
            f'<figcaption class="small">{self.ltr(caption)}</figcaption></figure>'
        )

    def _row(self, r: dict[str, Any]) -> str:
        color = html.escape(r.get("display_color") or "#999999")
        swatch = f'<span class="swatch" style="background:{color}"></span>'
        name = self.auto(r["name"], block=True)
        if r.get("note"):
            name += self.auto(r["note"], block=True, cls="small")
        if r["rejected"]:
            value = f'<span class="rejected">{self.bi(self.st["rejected"])}</span>' + "".join(
                f'<div class="small rejected">{self._point(p.get("point"))}{self.bi(p)}</div>'
                for p in r["rejection"]
            )
        else:
            value = f'<span class="nowrap">{self.bi(r["value_text"], block=True)}</span>'
        unc = r["uncertainty_text"]
        unc_html = self.bi(unc, block=True) if any(unc.values()) else ""
        basis = self._basis(r["depth_basis"])
        curve = r.get("curve")
        if curve and curve.get("cross_check_2d_m") is not None:
            basis += f'<div class="small">{self.bi(curve["cross_check_text"])}</div>'
        lines = r.get("lines")
        if lines:
            basis += f'<div class="small">{self.bi(lines["text"])}</div>'
        flags = "".join(self._chip(c) for c in r["flags"])
        confidence = r.get("confidence_label")
        if confidence and confidence.get("code") != "high":
            flags += self._chip({**confidence, "severity": "warn"})
        cells = [swatch, name, self.bi(r["kind_label"], block=True), value, unc_html, basis, flags]
        return "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"

    def measurement_table(self) -> str:
        cols = self.st["columns"]
        keys = ("color", "measurement", "kind", "value", "uncertainty", "depth_basis", "flags")
        head = "".join(f"<th>{self.bi(cols[k], block=True)}</th>" for k in keys)
        rows = "".join(self._row(r) for r in self.m["measurements"])
        summary = self.m["summary"]
        return (
            f"<h2>{self.bi(self.st['headings']['measurements'])}</h2>"
            f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"
            f'<p class="small">{self.bi(summary["snapped_text"])}'
            f"{self.esc(' · ')}{self.bi(summary['counts_text'])}</p>"
        )

    def scoring_form(self) -> str:
        rub, cols, h = self.st["rubric"], self.st["columns"], self.st["headings"]
        keys = ("region", "weight", "judge_score", "notes")
        head = "".join(f"<th>{self.bi(cols[k], block=True)}</th>" for k in keys)
        body = "".join(
            f"<tr><td>{self.ltr(row['num'])} {self.bi(row)}</td>"
            f'<td class="nowrap">{self.ltr(str(row["weight"]) + " %")}</td>'
            "<td></td><td></td></tr>"
            for row in rub["rows"]
        )
        weight = self.ltr(str(rub["total_weight"]) + " %")
        total = (
            f"<tr><th>{self.bi(cols['total'])}</th>"
            f'<th class="nowrap">{weight}</th><th></th><th></th></tr>'
        )
        return (
            f"<h2>{self.bi(h['scoring_form'])}</h2>"
            f'<p class="small">{self.bi(h["form_variant"])} {self.bi(rub["variant_label"])}</p>'
            f"<table><thead><tr>{head}</tr></thead><tbody>{body}{total}</tbody></table>"
        )

    def observations(self) -> str:
        given = self.m["inputs"].get("observations") or {}
        rows = []
        for f in self.st["observation_fields"]:
            value = given.get(f["key"]) or ""
            if value:
                cell = self.auto(value, block=True)
            else:
                hint = ""
                if f.get("placeholder"):
                    hint = f'<div class="small">{self.esc(f["placeholder"])}</div>'
                cell = hint + '<div class="blank"></div>'
            rows.append(f"<tr><th>{self.bi(f)}</th><td>{cell}</td></tr>")
        heading = self.st["headings"]["observations"]
        return f'<h2>{self.bi(heading)}</h2><table class="kv">{"".join(rows)}</table>'

    def signatures(self) -> str:
        fields = self.st["signature_fields"]
        wells = "".join(
            f'<div class="well"><div>{self.bi(w)}</div>'
            f'<div class="small">{self.bi(fields["name"])}: {self.auto(w.get("name"))}</div>'
            f'<div class="sign"></div><div class="small">{self.bi(fields["date"])}:</div></div>'
            for w in self.m["signature_wells"]
        )
        heading = self.bi(self.st["headings"]["signatures"])
        return f'<h2>{heading}</h2><div class="wells">{wells}</div>'

    def regions(self) -> str:
        cols = self.st["columns"]
        keys = ("arabic_name", "english", "body_part")
        head = "<th>#</th>" + "".join(f"<th>{self.bi(cols[k], block=True)}</th>" for k in keys)
        body = "".join(
            f"<tr><td>{self.ltr(r['num'])}</td><td>{self.esc(r['ar'])}</td>"
            f"<td>{self.ltr(r['en'])}</td><td>{self.esc(r['body_part_ar'])}</td></tr>"
            for r in self.st["regions_27"]
        )
        return (
            f"<h2>{self.bi(self.st['headings']['regions'])}</h2>"
            f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
        )

    def provenance(self) -> str:
        versions = self.m.get("versions") or {}
        libs = ", ".join(
            f"{key} {value}"
            for key, value in sorted(versions.items())
            if isinstance(value, str | int | float) and str(value) and len(str(value)) <= 80
        )
        ov, session = self.m["overlay"], self.m["session"]
        lines = [
            f"engine {self.m.get('engine_version')} - report model "
            f"v{self.m.get('report_model_version')} sha256 {self.report_model_sha256}",
            f"overlay {ov.get('file')} sha256 {ov.get('sha256')}",
            f"session {session['session_id']} revision {session['revision']}",
            libs,
        ]
        body = "".join(f'<div class="small">{self.ltr(line)}</div>' for line in lines if line)
        return (
            f"<footer><div>{self.bi(self.st['headings']['provenance'])}</div>{body}"
            f'<div class="small">{self.bi(self.st["disclaimer"])}</div></footer>'
        )

    def build(self, overlay_png: bytes, font_ttf: bytes, logo_png: bytes | None) -> str:
        parts = [
            self.header(logo_png),
            f'<div class="banner">{self.bi(TEST_BANNER)}</div>',
            self.session_table(),
            self.frame_table(),
            self.camel_view(overlay_png),
            self.measurement_table(),
            '<div class="page"></div>',
            self.scoring_form(),
            self.observations(),
            self.signatures(),
            '<div class="page"></div>',
            self.regions(),
            self.provenance(),
        ]
        direction, doc_lang = ("ltr", "en") if self.lang == "en" else ("rtl", "ar")
        title = f"{self.st['title']['en']} - {self.m['session']['session_id']}"
        css = CSS.replace("__FONT__", b64(font_ttf))
        return (
            f'<!doctype html><html lang="{doc_lang}" dir="{direction}"><head>'
            f'<meta charset="utf-8"><title>{html.escape(title)}</title><style>{css}</style>'
            f"</head><body>{''.join(parts)}</body></html>"
        )


def missing_glyphs(texts: list[str], font_ttf: bytes) -> list[str]:
    """Characters the page draws that the embedded face lacks (Chromium would fall back to
    another font for them)."""
    cmap = TTFont(io.BytesIO(font_ttf)).getBestCmap()
    chars = {ch for text in texts for ch in text if not ch.isspace()}
    return sorted(f"U+{ord(ch):04X} {ch}" for ch in chars if ord(ch) not in cmap)


def find_edge() -> Path | None:
    for path in EDGE_PATHS:
        if path.is_file():
            return path
    found = shutil.which("msedge")
    return Path(found) if found else None


def edge_version(edge: Path) -> str | None:
    versions = [
        d.name
        for d in edge.parent.iterdir()
        if d.is_dir() and re.fullmatch(r"\d+(\.\d+){3}", d.name)
    ]
    if not versions:
        return None
    return max(versions, key=lambda v: tuple(int(p) for p in v.split(".")))


def print_with_edge(edge: Path, page_html: str, workdir: Path) -> tuple[bytes, dict[str, Any]]:
    """Headless Edge ``--print-to-pdf``: Electron's Chromium printer and Skia PDF backend."""
    workdir.mkdir(parents=True, exist_ok=True)
    page = workdir / "print_page.html"
    page.write_text(page_html, encoding="utf-8")
    out = workdir / "printed.pdf"
    out.unlink(missing_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="nazeer_edge_"))
    cmd = [
        str(edge),
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        f"--user-data-dir={profile}",
        "--no-pdf-header-footer",
        "--virtual-time-budget=10000",
        f"--print-to-pdf={out}",
        page.as_uri(),
    ]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=240, check=False)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    info = {
        "edge": str(edge),
        "version": edge_version(edge),
        "seconds": round(time.perf_counter() - t0, 2),
        "exit_code": proc.returncode,
    }
    if not out.is_file():
        tail = proc.stderr.decode("utf-8", "replace")[-600:]
        raise CheckFailed(f"Edge printed nothing (exit {proc.returncode}): {tail}")
    return out.read_bytes(), info


# ----- the flow --------------------------------------------------------------------------------


@dataclass
class Run:
    args: argparse.Namespace
    out: Path
    api: Api
    record: dict[str, Any]
    checks: list[dict[str, Any]] = field(default_factory=list)

    def check(self, name: str, passed: bool, detail: str = "") -> bool:
        self.checks.append({"check": name, "ok": bool(passed), "detail": detail})
        print(f"    [{'ok' if passed else 'FAIL'}] {name}" + (f": {detail}" if detail else ""))
        return bool(passed)

    def must(self, name: str, passed: bool, detail: str = "") -> None:
        if not self.check(name, passed, detail):
            raise CheckFailed(f"{name}: {detail}")


def step(title: str) -> float:
    print(f"\n== {title}")
    return time.perf_counter()


def done(run: Run, key: str, t0: float) -> None:
    run.record.setdefault("timings_s", {})[key] = round(time.perf_counter() - t0, 2)


def step_engine(run: Run) -> None:
    t0 = step("1. engine: health, versions, labels")
    health = run.api.call("get_health", "GET", "/health").json()
    model, arabic = health["model"], health["arabic_stack"]
    run.check(
        "health ok, real model loaded",
        health["status"] == "ok" and not model["stub"],
        f"{model['file']} sha256 {str(model['sha256'])[:16]}..., "
        f"warm-up {num(health.get('warmup_ms'), '.0f')} ms",
    )
    run.check(
        "Arabic stack ok with the pinned font",
        arabic["ok"] and arabic["font_pinned"],
        f"native layout (libraqm) = {arabic.get('native_layout')}",
    )
    versions = run.api.call("get_versions", "GET", "/versions").json()
    labels = run.api.call("get_labels", "GET", "/meta/labels").json()
    run.record["engine"] = {"health": health, "versions": versions, "label_groups": sorted(labels)}
    print(f"    engine {health['engine_version']} pid {health['pid']}")
    print(f"    data root {health['data_root']}")
    done(run, "engine_checks", t0)


def step_bag(run: Run, bag: Path) -> dict[str, Any]:
    t0 = step("2. open the bag")
    info = run.api.call("inspect_bag", "POST", "/bags/inspect", json_body={"path": str(bag)}).json()
    run.record["bag"] = info
    color = info["color"]
    print(
        f"    {info['name']}: {info['size_bytes'] / 1e9:.2f} GB, {info['duration_s']:.1f} s, "
        f"~{info['n_frames_estimate']} frames, colour {color['format']} "
        f"{color['width']}x{color['height']}, every {info['sample_every_effective']}th pair sampled"
    )
    run.check(
        "colour stream is rgb8 (converted to BGR once by the reader)",
        color["format"] == "format.rgb8",
    )
    done(run, "inspect_bag", t0)
    return info


def wait_job(run: Run, job_id: str, timeout: float = 900.0) -> dict[str, Any]:
    t0 = last = time.monotonic()
    while True:
        snap = run.api.call("get_candidate_job", "GET", f"/candidates/jobs/{job_id}").json()
        now = time.monotonic()
        if snap["terminal"] or now - last >= 3.0:
            c = snap["counters"]
            eta = f"{snap['eta_s']:.0f} s" if snap.get("eta_s") is not None else "--"
            print(
                f"    {snap['stage']:<10} {snap['progress_fraction']:6.1%}  read {c['read']:>5}  "
                f"sampled {c['sampled']:>4}  detected {c['detected']:>4}  passed {c['passed']:>4}  "
                f"eta {eta}"
            )
            last = now
        if snap["terminal"]:
            return snap
        if now - t0 > timeout:
            path = f"/candidates/jobs/{job_id}/cancel"
            run.api.call("cancel_candidate_job", "POST", path, expect=(202,))
            raise CheckFailed(f"candidate job still running after {timeout:.0f} s (cancelled)")
        time.sleep(0.5)


def step_candidates(run: Run, bag: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    t0 = step("3. candidate walk: the best frames by mask depth MSE")
    start = run.api.call(
        "start_candidate_job",
        "POST",
        "/candidates/jobs",
        json_body={"bag_path": str(bag)},
        expect=(200, 202),
    ).json()
    if start["cached"]:
        print("    cache hit: this data root already walked the bag with these params")
        fp, ph = start["result"]["fingerprint"], start["result"]["params_hash"]
        job = None
    else:
        job = wait_job(run, start["job"]["job_id"])
        if job["state"] != "done":
            raise CheckFailed(f"candidate job {job['state']}: {job.get('error')}")
        fp, ph = job["result"]["fingerprint"], job["result"]["params_hash"]
    walk_s = time.perf_counter() - t0
    grid = run.api.call("get_candidates", "GET", f"/candidates/{fp}/{ph}").json()
    cands, walk, params = grid["candidates"], grid["walk"], grid["params"]
    run.record["job"] = job
    run.record["candidate_set"] = {k: v for k, v in grid.items() if k != "frames"}
    buckets = ", ".join(
        f"{b} {n}" for b, n in sorted(Counter(c.get("bucket") for c in cands).items(), key=str)
    )
    print(
        f"    {walk['n_pairs']} pairs read, {walk['n_sampled']} sampled, {len(cands)} proposed "
        f"({buckets}) in {walk_s:.1f} s"
    )
    rejected = ", ".join(f"{k} {v}" for k, v in sorted(grid["rejected_by_reason"].items()))
    print(f"    rejected by reason: {rejected or 'none'}")
    run.must("at least one frame proposed", len(cands) >= 1, f"{len(cands)} of m = {params['m']}")
    run.check(
        "the walk read the whole bag",
        bool(walk.get("walk_complete")),
        str(walk.get("end_reason")),
    )
    gates = all(
        c["z_mean"] >= 1.0
        and params["maf_low"] <= c["mask_area_frac"] <= params["maf_high"]
        and c["valid_frac"] >= params["valid_frac_min"]
        for c in cands
    )
    run.check("every proposal passes the operator gates (z_mean >= 1 m, MAF, valid)", gates)
    times = sorted(c["read_index"] / walk["fps"] for c in cands)
    gaps = [b - a for a, b in zip(times, times[1:], strict=False)]
    run.check(
        "proposals are >= 1.5 s apart",
        all(g >= params["bin_sec"] - 1e-9 for g in gaps),
        f"smallest gap {min(gaps):.2f} s" if gaps else "one proposal",
    )

    # the selected best frames, saved into the run folder through the API (what the grid shows)
    folder = run.out / "candidates"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "candidates.json").write_text(
        json.dumps(run.record["candidate_set"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    picked = pick_candidate(cands, run.args.pick)
    tiles = []
    for i, cand in enumerate(sorted(cands, key=lambda c: c["read_index"]), 1):
        rgb = run.api.get_bytes("get_candidate_asset", cand["urls"]["rgb"])
        mask = decode_mask(run.api.get_bytes("get_candidate_asset", cand["urls"]["mask"]))
        run.api.get_bytes("get_candidate_asset", cand["urls"]["thumb"])
        (folder / f"{i:02d}_{cand['candidate_id']}_{cand.get('bucket')}.png").write_bytes(rgb)
        lines = [
            f"{i}. {cand['candidate_id']} {cand.get('bucket')}  t {cand['bag_time_s']:.1f} s",
            f"z_med {num(cand['z_median'], '.2f')} m  MSE {num(cand['z_var'], '.4f')}  "
            f"MAF {num(cand['mask_area_frac'], '.2f')}",
        ]
        tiles.append(candidate_tile(decode_bgr(rgb), mask, lines, cand is picked))
    ok, jpg = cv2.imencode(".jpg", contact_sheet(tiles), [cv2.IMWRITE_JPEG_QUALITY, 90])
    if ok:
        (folder / "contact_sheet.jpg").write_bytes(jpg.tobytes())
    print(f"    saved {len(cands)} frames + contact_sheet.jpg in {folder}")
    done(run, "candidates", t0)
    return grid, picked


def step_session(run: Run, cand: dict[str, Any]) -> tuple[dict[str, Any], str, np.ndarray]:
    t0 = step("4. pick a frame, start the session")
    print(
        f"    picked {cand['candidate_id']} ({cand.get('bucket')}, read index "
        f"{cand['read_index']}, t {cand['bag_time_s']:.2f} s, z_median "
        f"{num(cand['z_median'], '.3f')} m, depth MSE {num(cand['z_var'], '.4f')}) "
        f"by --pick {run.args.pick}"
    )
    body = {
        "candidate": cand["ref"],
        "camel_id": run.args.camel_id,
        "operator": "المشغل",
        "notes": f"real-bag check ({CLIENT_VERSION}): random measurements, seed {run.args.seed}",
    }
    reply = run.api.call("create_session", "POST", "/sessions", json_body=body, expect=(201,))
    view, etag = reply.json(), reply.headers["ETag"]
    sid = view["session_id"]
    reopened = run.api.call("get_session", "GET", f"/sessions/{sid}").json()
    run.check(
        "session created and reopened at revision 0",
        view["revision"] == 0 and reopened["revision"] == 0,
        sid,
    )
    z = view["frame"]["z_ref"]
    run.check(
        "Z_ref = the candidate's eroded-mask median",
        abs(z["z_ref_m"] - cand["z_median"]) < 1e-6,
        f"{z['z_ref_m']:.3f} m ({z['statistic']})",
    )
    mask = decode_mask(run.api.get_bytes("get_session_asset", view["frame"]["assets"]["mask"]))
    run.record["session_created"] = {"session_id": sid, "etag": etag, "frame": view["frame"]}
    done(run, "create_session", t0)
    return view, etag, mask


def expected_probe(role: str, probe: dict[str, Any]) -> bool:
    if role in ("inside", "hoof"):
        return probe["inside_mask"] and probe["source"] in INSIDE_SOURCES
    if role == "outside":
        return (not probe["inside_mask"]) and probe["source"] in OUTSIDE_SOURCES
    if role == "ground":  # C1.4: a ground point keeps its own depth, or says it could not
        return probe["target"] == "ground" and (
            probe["source"] == "direct_off_mask" or "ground_target_unresolved" in probe["flags"]
        )
    return True


def step_measure(run: Run, view: dict[str, Any], etag: str, mask: np.ndarray) -> dict[str, Any]:
    t0 = step(f"5. random distances (seed {run.args.seed}): hover, drag preview, autosave")
    sid = view["session_id"]
    ground_row = int(view["frame"]["ground"]["drawn_row"])
    clicks = Clicks(mask, ground_row, np.random.default_rng(run.args.seed))
    planned = plan_measurements(clicks, n_each=run.args.distances, angles=run.args.angles)
    revision, seq = view["revision"], 0
    probes: list[dict[str, Any]] = []
    previews: dict[int, Any] = {}
    body: dict[str, Any] = {}
    saved: dict[str, Any] = view
    for k, plan in enumerate(planned, 1):
        item = plan.item
        targets = item.get("targets") or ["camel"] * len(item["points"])
        for i, (point, role, target) in enumerate(
            zip(item["points"], plan.roles, targets, strict=True), 1
        ):
            seq += 1
            probe = run.api.call(
                "probe_depth",
                "POST",
                f"/sessions/{sid}/depth",
                json_body={"u": point[0], "v": point[1], "target": target, "seq": seq},
            ).json()
            probes.append(
                {
                    "measurement": item["id"],
                    "point": i,
                    "role": role,
                    "uv": point,
                    "source": probe["source"],
                    "depth_m": probe["depth_m"],
                    "inside_mask": probe["inside_mask"],
                    "flags": probe["flags"],
                    "basis_en": probe["basis"]["en"],
                    "as_expected": probe["seq"] == seq and expected_probe(role, probe),
                }
            )
        seq += 1
        preview = run.api.call(
            "preview_measurement",
            "POST",
            f"/sessions/{sid}/preview",
            json_body={"measurement": item, "seq": seq},
        ).json()
        previews[item["id"]] = preview["row"]["presentation"]["value"]
        body = {
            "revision": revision + 1,
            "next_measurement_id": item["id"] + 1,
            "measurements": [p.item for p in planned[:k]],
        }
        reply = run.api.call(
            "put_document",
            "PUT",
            f"/sessions/{sid}/document",
            json_body=body,
            headers={"If-Match": etag},
        )
        saved, etag = reply.json(), reply.headers["ETag"]
        if saved["revision"] != revision + 1:
            raise CheckFailed(f"autosave stored revision {saved['revision']}, sent {revision + 1}")
        revision = saved["revision"]
    unexpected = [p for p in probes if not p["as_expected"]]
    run.check(
        "hover probes resolve as placed (inside: direct, outside: KNN snap, ground: direct)",
        not unexpected,
        f"{len(probes)} probes" + (f", unexpected: {unexpected}" if unexpected else ""),
    )
    run.check(
        f"{len(planned)} autosaves with If-Match, one revision each",
        revision == len(planned),
        f"revision {revision}, ETag {etag}",
    )

    # autosave edges the Redux store relies on (B43)
    path = f"/sessions/{sid}/document"
    replay = run.api.call("put_document", "PUT", path, json_body=body)
    run.check(
        "an identical replay of the stored revision is a 200 and changes nothing",
        replay.json()["revision"] == revision and replay.headers["ETag"] == etag,
    )
    stale = dict(body, measurements=body["measurements"][:-1])
    conflict = run.api.call("put_document", "PUT", path, json_body=stale, expect=(409,)).json()
    error = conflict["error"]
    run.check(
        "a stale save is a 409 stale_revision carrying the current view",
        error["code"] == "stale_revision" and error["details"]["current"]["revision"] == revision,
    )

    rows = {r["id"]: r for r in saved["measurements"]}

    def same(a: float | None, b: float | None) -> bool:
        return (a is None and b is None) or (a is not None and b is not None and abs(a - b) < 1e-9)

    run.check(
        "drag previews equal the saved values",
        all(same(previews[i], rows[i]["presentation"]["value"]) for i in previews),
    )
    curve_2d = next(r for r in saved["measurements"] if r["kind"] == "curve_2d")
    curve_3d = next(r for r in saved["measurements"] if r["kind"] == "curve_3d")
    run.check(
        "the 3D curve's 2D cross-check equals the 2D curve on the same points",
        same(curve_3d["cross_check_2d_m"], curve_2d["presentation"]["value"]),
    )
    for r in saved["measurements"]:
        pres = r["presentation"]
        value = REJECTED["en"] if pres["rejected"] else pres["value_text"]["en"]
        basis = "; ".join(b["en"] for b in pres["depth_basis"])
        flags = ",".join(c["code"] for c in pres["flags"])
        print(
            f"    #{r['id']:<2} {r['kind']:<17} {value:>10}  {pres['uncertainty_text']['en']:<10}"
            f" {basis}" + (f"  [{flags}]" if flags else "")
        )
    run.record["measurements"] = {
        "seed": run.args.seed,
        "planned": [{"input": p.item, "roles": p.roles} for p in planned],
        "probes": probes,
        "saved": saved["measurements"],
        "summary": saved["summary"],
    }
    print(f"    {saved['summary']['snapped_text']['en']}")
    done(run, "measure", t0)
    return saved


def step_finalize(run: Run, view: dict[str, Any]) -> tuple[dict[str, Any], bytes, bytes]:
    t0 = step("6. finalize: the engine renders the overlay once, freezes the report model")
    sid = view["session_id"]
    body = {
        "revision": view["revision"],
        "report_inputs": {
            "language": run.args.language,
            "rubric_variant": "mjaheem",
            "names": {
                "judge": "حكم الاختبار",
                "council": "مجلس حكام الاختبار",
                "event": "مزاين الإبل - تشغيل تجريبي",
            },
            "observations": {"manual": "تشغيل تجريبي: القياسات عشوائية وليست قياسات حكم."},
        },
    }
    path = f"/sessions/{sid}/finalize"
    view = run.api.call("finalize_session", "POST", path, json_body=body).json()
    overlay, model_out = view["outputs"]["overlay"], view["outputs"]["report_model"]
    png = run.api.get_bytes("get_session_asset", overlay["url"])
    model_bytes = run.api.get_bytes("get_session_asset", model_out["url"])
    frame = view["frame"]
    run.must("status finalized", view["status"] == "finalized", view["status"])
    run.must(
        "overlay bytes match the engine's sha256 (the app re-hashes with WebCrypto)",
        sha256(png) == overlay["sha256"],
        overlay["sha256"],
    )
    run.check(
        "overlay is W x (H + 120 px footer)",
        (overlay["width"], overlay["height"]) == (frame["width"], frame["height"] + 120),
        f"{overlay['width']} x {overlay['height']}",
    )
    run.must(
        "report model bytes match its sha256",
        sha256(model_bytes) == model_out["sha256"],
        f"v{model_out['version']} {model_out['sha256'][:16]}...",
    )
    (run.out / overlay["file"]).write_bytes(png)
    (run.out / model_out["file"]).write_bytes(model_bytes)
    run.record["finalize"] = {
        "outputs": view["outputs"],
        "required_report_texts": view["required_report_texts"],
    }
    print(f"    {overlay['file']} {overlay['width']}x{overlay['height']}, {model_out['file']}")
    done(run, "finalize", t0)
    return view, png, model_bytes


def step_print(run: Run, view: dict[str, Any], png: bytes, model_bytes: bytes) -> bytes:
    t0 = step("7. print: report model -> print page -> headless Edge (printToPDF stand-in)")
    edge = find_edge()
    if edge is None:
        raise CheckFailed("Microsoft Edge (msedge.exe) not found: nothing to print with")
    run.api.app_headers["X-Chromium"] = f"{edge_version(edge)} (Microsoft Edge headless)"
    model = strict_json(model_bytes)
    font = FONT_PATH.read_bytes()
    page = PrintPage(model, report_model_sha256=sha256(model_bytes))
    page_html = page.build(png, font, LOGO_PATH.read_bytes() if LOGO_PATH.is_file() else None)
    drawn = "".join(page.texts)
    required = view["required_report_texts"]
    run.check(
        "every required_report_texts string is on the page",
        all(t in drawn for t in required),
        f"{len(required)} strings",
    )
    missing = missing_glyphs(page.texts, font)
    run.check(
        "every character drawn exists in IBM Plex Sans Arabic (no fallback face)",
        not missing,
        ", ".join(missing) or "all covered",
    )
    printed, info = print_with_edge(edge, page_html, run.out / "print")
    reader = PdfReader(io.BytesIO(printed))
    box = reader.pages[0].mediabox
    size = (float(box.width), float(box.height))
    info.update(
        {
            "pages": len(reader.pages),
            "page_size_pt": [round(v, 2) for v in size],
            "bytes": len(printed),
            "missing_glyphs": missing,
        }
    )
    run.check(
        "A4 pages",
        all(abs(a - b) < 1.0 for a, b in zip(size, A4_PT, strict=True)),
        f"{len(reader.pages)} pages of {size[0]:.1f} x {size[1]:.1f} pt",
    )
    run.record["print"] = info
    print(
        f"    Edge {info['version']}: {info['pages']} pages, {len(printed) / 1e6:.2f} MB, "
        f"{info['seconds']} s"
    )
    done(run, "print", t0)
    return printed


def step_upload(run: Run, view: dict[str, Any], printed: bytes) -> dict[str, Any]:
    t0 = step("8. upload: probes (pixels, text, fonts), evidence attachments, manifest")
    sid = view["session_id"]
    overlay, model_out = view["outputs"]["overlay"], view["outputs"]["report_model"]
    headers = {
        "Content-Type": "application/pdf",
        "X-Overlay-Sha256": overlay["sha256"],
        "X-Overlay-Version": str(overlay["version"]),
        "X-Report-Model-Sha256": model_out["sha256"],
    }
    reply = run.api.call(
        "upload_report",
        "POST",
        f"/sessions/{sid}/report",
        body=printed,
        headers=headers,
        expect=(200, 409),
    )
    data = reply.json()
    if reply.status == 409:
        run.record["upload_refused"] = data
        details = data["error"].get("details") or {}
        raise CheckFailed(
            f"upload refused: {data['error']['code']}; hard failures "
            f"{(details.get('probe') or {}).get('hard_failures')}; kept as "
            f"{details.get('rejected_file')}"
        )
    probe, view = data["probe"], data["session"]
    run.check(
        "verdict PASS (strict text + font probes)",
        probe["verdict"] == "PASS",
        f"hard {probe['hard_failures']}, soft {probe['soft_failures']}",
    )
    match = probe["pixel"]["match"] or {}
    run.check(
        "the PDF's image is the overlay, pixel for pixel",
        probe["pixel"]["ok"] and match.get("max_abs_diff") == 0,
        f"page {match.get('page')}, max |diff| {match.get('max_abs_diff')}",
    )
    text = probe["text"]
    run.check(
        "every operator string is searchable in the text layer",
        text["ok"],
        f"{sum(1 for n in text['names'] if n['ok'])}/{len(text['names'])} found",
    )
    run.check(
        "IBM Plex Sans Arabic subset embedded, no Type3 (synthesized) face",
        probe["fonts"]["ok"] and not probe["fonts"]["type3_present"],
        ", ".join(probe["fonts"]["fonts"]),
    )
    run.check(
        "overlay, session.json and report_model.json attached and read back",
        probe["attachments_ok"],
        ", ".join(probe["attachments"]["files"]),
    )
    run.check("status exported", view["status"] == "exported", view["status"])
    run.record["upload"] = {"probe": probe, "outputs": view["outputs"]}
    done(run, "upload", t0)
    return view


def step_final(run: Run, view: dict[str, Any], png: bytes, model_bytes: bytes) -> Path:
    t0 = step("9. the sealed PDF, manifest and History")
    sid = view["session_id"]
    report = view["outputs"]["report"]
    pdf = run.api.get_bytes("get_report", f"/sessions/{sid}/report")
    final = run.out / "final_report.pdf"
    final.write_bytes(pdf)
    run.check(
        "final PDF bytes match the engine's sha256",
        sha256(pdf) == report["sha256"],
        f"{report['file']} {report['sha256'][:16]}...",
    )
    attachments = PdfReader(io.BytesIO(pdf)).attachments
    overlay_name = view["outputs"]["overlay"]["file"]
    run.check(
        "attachments inside the PDF",
        set(attachments) == {overlay_name, "session.json", "report_model.json"},
        ", ".join(sorted(attachments)),
    )
    run.check(
        "attached overlay = the approved PNG, byte for byte",
        any(sha256(a) == sha256(png) for a in attachments.get(overlay_name, [])),
    )
    run.check(
        "attached report model = the one the page was printed from",
        any(sha256(a) == sha256(model_bytes) for a in attachments.get("report_model.json", [])),
    )
    session_json = strict_json(attachments["session.json"][0])
    names = {r["name"] for r in run.record["measurements"]["saved"]}
    stored = {m["name"] for key in ("lines", "curves", "angles") for m in session_json.get(key, [])}
    run.check(
        "attached session.json is schema 2.1 with every measurement",
        session_json.get("schema_version") == "2.1" and names <= stored,
        f"{len(stored)} measurements",
    )
    manifest = run.api.get_bytes("get_session_asset", view["outputs"]["manifest_url"])
    (run.out / "report.manifest.json").write_bytes(manifest)
    params = {"q": run.args.camel_id}
    history = run.api.call("list_sessions", "GET", "/sessions", params=params).json()
    row = next((r for r in history["items"] if r["session_id"] == sid), None)
    run.check(
        "History lists the session as exported (search by the Arabic camel id)",
        row is not None and row["status"] == "exported",
        f"{history['total']} match(es)",
    )
    run.record["final"] = {"pdf": str(final), "sha256": sha256(pdf), "history_row": row}
    done(run, "final", t0)
    return final


def report_console(run: Run, final: Path | None) -> None:
    failed = [c for c in run.checks if not c["ok"]]
    passed = final is not None and not failed and "failure" not in run.record
    run.record["verdict"] = "PASS" if passed else "FAIL"
    calls = run.api.calls
    n_ops = len({c["op"] for c in calls})
    print(
        f"\n== {run.record['verdict']}: {len(run.checks) - len(failed)}/{len(run.checks)} checks "
        f"passed, {len(calls)} HTTP calls over {n_ops} operations"
    )
    for c in failed:
        print(f"   FAIL {c['check']}: {c['detail']}")
    if "failure" in run.record:
        print(f"   stopped: {run.record['failure']}")
    print(f"   run folder   {run.out}")
    if final is not None:
        print(f"   final PDF    {final}")
    print(f"   candidates   {run.out / 'candidates' / 'contact_sheet.jpg'}")
    print(f"   timings (s)  {json.dumps(run.record.get('timings_s', {}))}")


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--bag", default=str(DEFAULT_BAG), help="a D455 .bag (default: bag 006)")
    parser.add_argument("--out", help="run folder (default: runs/real_run_<UTC stamp>)")
    parser.add_argument("--data-root", help="engine data root (default: <run folder>/data_root)")
    parser.add_argument("--seed", type=int, help="random clicks (default: a fresh one, recorded)")
    parser.add_argument("--pick", default="auto", help="auto | tile number | candidate id")
    parser.add_argument("--distances", type=int, default=3, help="2D and 3D distances, each")
    parser.add_argument("--angles", action="store_true", help="also two random angles")
    parser.add_argument("--language", choices=("ar", "en", "both"), default="both")
    parser.add_argument("--camel-id", default="جمل-تجربة-1")
    args = parser.parse_args(argv)
    if args.seed is None:
        args.seed = secrets.randbelow(2**31)
    if args.distances < 1:
        parser.error("--distances must be >= 1")
    bag = Path(args.bag).resolve()
    if not bag.is_file():
        parser.error(f"bag not found: {bag}")
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%SZ")
    out = Path(args.out).resolve() if args.out else PROJECT_DIR / "runs" / f"real_run_{stamp}"
    data_root = Path(args.data_root).resolve() if args.data_root else out / "data_root"
    out.mkdir(parents=True, exist_ok=True)
    print(f"Nazeer real-bag check: {bag.name}, seed {args.seed}, run folder {out}")

    token = secrets.token_hex(16)
    engine = Engine(data_root, token, out / "engine.stderr.log")
    record: dict[str, Any] = {
        "tool": CLIENT_VERSION,
        "started_at": now_iso(),
        "args": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "data_root": str(data_root),
    }
    api = Api("", token, app_headers={"X-App-Version": CLIENT_VERSION})
    run = Run(args, out, api, record)
    final: Path | None = None
    started = False
    try:
        t0 = step("0. spawn the engine sidecar (model load + warm-up)")
        ready = engine.start()
        started = True
        api.base = f"http://127.0.0.1:{ready['port']}"
        record["ready_line"] = ready
        warmup = num(ready.get("warmup_ms"), ".0f")
        print(f"    ready on port {ready['port']} (pid {ready['pid']}, warm-up {warmup} ms)")
        done(run, "engine_start", t0)
        step_engine(run)
        step_bag(run, bag)
        _, picked = step_candidates(run, bag)
        view, etag, mask = step_session(run, picked)
        saved = step_measure(run, view, etag, mask)
        view, png, model_bytes = step_finalize(run, saved)
        printed = step_print(run, view, png, model_bytes)
        view = step_upload(run, view, printed)
        final = step_final(run, view, png, model_bytes)
    except CheckFailed as exc:
        record["failure"] = str(exc)
    except Exception as exc:
        record["failure"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        t0 = time.perf_counter()
        exit_code = engine.stop(api if started else None)
        record["engine_exit_code"] = exit_code
        record["engine_stdout_noise"] = engine.stdout_noise
        record.setdefault("timings_s", {})["shutdown"] = round(time.perf_counter() - t0, 2)
        record["checks"] = run.checks
        record["api_calls"] = {
            "total": len(api.calls),
            "by_operation": dict(Counter(c["op"] for c in api.calls)),
            "non_2xx": [c for c in api.calls if not 200 <= c["status"] < 300],
        }
        report_console(run, final)
        record["finished_at"] = now_iso()
        (out / "summary.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2, allow_nan=False, default=str),
            encoding="utf-8",
        )
        print(f"   engine exit  {exit_code}; summary {out / 'summary.json'}")
    return 0 if record.get("verdict") == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
