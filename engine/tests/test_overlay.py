from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import arabic, assets, fsio
from nazeer_engine.errors import ArabicStackMissing
from nazeer_engine.history import HistoryIndex
from nazeer_engine.overlay import render_overlay_png
from nazeer_engine.session_store import SessionStore
from tests.factories import make_candidate

MEASUREMENTS = [
    # order 0 -> assign_color(0) = #BE2C2C; the last point lies outside the mask (KNN)
    {
        "id": 1,
        "kind": "curve_3d",
        "name": "منحنى الظهر",
        "points": [[500, 300], [600, 300], [985, 380]],
    },
    {"id": 2, "kind": "distance_3d", "name": "طول الجسم", "points": [[400, 450], [900, 450]]},
    {"id": 3, "kind": "distance_2d", "name": "Height 2D", "points": [[700, 250], [700, 550]]},
    {"id": 4, "kind": "curve_2d", "name": "رقبة", "points": [[350, 220], [420, 240], [480, 230]]},
    {
        "id": 5,
        "kind": "angle_2d_3point",
        "name": "زاوية",
        "points": [[820, 300], [900, 300], [820, 380]],
    },
    {
        "id": 6,
        "kind": "angle_3d_3point",
        "name": "3D angle",
        "points": [[450, 500], [550, 500], [450, 540]],
    },
    {
        "id": 7,
        "kind": "angle_2d_from_horizontal",
        "name": "ميل",
        "points": [[310, 520], [380, 480]],
    },
    {"id": 8, "kind": "angle_4point", "name": "بين الخطين", "line_a_id": 2, "line_b_id": 9},
    {"id": 9, "kind": "distance_3d", "name": "عمودي", "points": [[650, 250], [650, 500]]},
    {"id": 10, "kind": "distance_3d", "name": "مرفوض", "points": [[400, 300], [1250, 366]]},
]


@pytest.fixture(scope="module")
def session(tmp_path_factory):
    root = tmp_path_factory.mktemp("overlay") / "root"
    root.mkdir()
    store = SessionStore(root, HistoryIndex(root / "history.sqlite"))
    doc, _ = store.create(make_candidate(root), camel_id="جمل-7")
    doc = store.save_document(
        doc.session_id, 1, {"camel_id": "جمل-7", "measurements": MEASUREMENTS}
    )
    sdir = store.session_dir(doc.session_id)
    bgr = fsio.read_image(sdir / "rgb.png")
    mask = fsio.read_image(sdir / "mask.png")
    return doc, bgr, mask


def _rgb_at(png_bytes: bytes, u: int, v: int) -> tuple[int, int, int]:
    img = fsio.decode_image(png_bytes)
    b, g, r = (int(x) for x in img[v, u, :3])
    return r, g, b


def _hex(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def test_overlay_size_meta_and_determinism(session):
    doc, bgr, mask = session
    png, meta = render_overlay_png(bgr, doc, mask=mask, rendered_at="2026-10-11T10:00:00+00:00")
    img = fsio.decode_image(png)
    assert img.shape[:2] == (840, 1280) and meta["width"] == 1280 and meta["height"] == 840
    assert meta["frame_height"] == 720 and meta["footer_px"] == 120
    assert meta["n_lines"] == 4 and meta["n_curves"] == 2 and meta["n_angles"] == 4
    assert meta["n_rejected"] == 1 and meta["n_points_knn"] >= 1
    assert meta["font_file"] == "IBMPlexSansArabic-Regular.ttf" and len(meta["font_sha256"]) == 64
    again, _ = render_overlay_png(bgr, doc, mask=mask, rendered_at="2026-10-11T10:00:00+00:00")
    assert again == png  # byte-identical for identical inputs
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and b"Software" not in png[:4096]


def test_knn_points_are_hollow_and_direct_points_filled(session):
    doc, bgr, mask = session
    png, _ = render_overlay_png(bgr, doc, mask=mask, rendered_at="x")
    row_color = _hex("#BE2C2C")
    direct = _rgb_at(png, 500, 301)  # first curve point: direct depth -> filled marker
    hollow = _rgb_at(png, 985, 382)  # last curve point: KNN -> ring, background inside
    assert max(abs(a - b) for a, b in zip(direct, row_color, strict=True)) <= 6
    assert max(abs(a - b) for a, b in zip(hollow, row_color, strict=True)) > 60
    background = tuple(int(x) for x in bgr[382, 985, ::-1])
    assert max(abs(a - b) for a, b in zip(hollow, background, strict=True)) <= 12


def test_ground_line_is_drawn_on_the_near_plane_row(session):
    doc, bgr, mask = session
    png, meta = render_overlay_png(bgr, doc, mask=mask, rendered_at="x")
    assert meta["ground_row"] == 640
    red = (255, 51, 51)
    on_line = _rgb_at(png, 270, 640)
    below = _rgb_at(png, 270, 650)
    assert (
        max(abs(a - b) for a, b in zip(on_line, red, strict=True)) <= 20
    )  # line snapping blends ~5 %
    assert max(abs(a - b) for a, b in zip(below, red, strict=True)) > 60


def test_footer_is_white_band_below_the_frame(session):
    doc, bgr, mask = session
    png, _ = render_overlay_png(bgr, doc, mask=mask, rendered_at="x")
    img = fsio.decode_image(png)
    footer = img[720:, :, :3]
    assert (footer == 255).mean() > 0.85  # mostly white paper with three lines of text
    assert (footer != 255).any()  # but the text is there


def test_arabic_text_is_passed_logically_to_libraqm_and_missing_font_is_typed(monkeypatch, session):
    # matplotlib 3.11 shapes and reorders itself (libraqm); pre-shaped visual text would be
    # reversed twice (B36). Labels are LTR paragraphs with each Arabic part isolated.
    assert arabic.native_layout()
    assert arabic.isolate("طول الجسم") == arabic.FSI + "طول الجسم" + arabic.PDI
    assert arabic.isolate("Body length") == "Body length" and arabic.isolate("") == ""
    assert arabic.display_text("طول الجسم") == "طول الجسم"
    assert arabic.ltr("x") == arabic.LRM + "x"
    status = arabic.stack_status()
    assert status["ok"] and status["native_layout"] is True and len(status["font_sha256"]) == 64
    doc, bgr, mask = session
    arabic.reset_stack()

    def missing() -> Path:
        raise ArabicStackMissing("Arabic font missing: test")

    monkeypatch.setattr(assets, "font_path", missing)
    try:
        with pytest.raises(ArabicStackMissing):
            render_overlay_png(bgr, doc, mask=mask)
        assert arabic.stack_status()["ok"] is False
    finally:
        monkeypatch.undo()
        arabic.reset_stack()
    assert arabic.stack_status()["ok"]


def _block_matplotlib(monkeypatch) -> None:
    # the parent and every compiled module: `from matplotlib import ft2font` returns a cached
    # attribute and import_module a cached submodule unless each name is blocked
    for name in ("matplotlib", *arabic.MATPLOTLIB_BINARY_MODULES):
        monkeypatch.setitem(sys.modules, name, None)


def test_a_matplotlib_that_cannot_load_is_a_missing_stack(monkeypatch, session):
    # Smart App Control blocked matplotlib._c_internal_utils on the dev laptop (2026-10-12) and
    # the stack still said ok (reshaper fallback): it must say what is missing instead
    doc, bgr, mask = session
    arabic.reset_stack()
    try:
        _block_matplotlib(monkeypatch)
        assert arabic.matplotlib_problem() is not None
        status = arabic.stack_status()
        assert status["ok"] is False and "matplotlib" in status["reason"]
        assert status["native_layout"] is None and status["font_sha256"] is None
        with pytest.raises(ArabicStackMissing) as raised:
            arabic.ensure_arabic_stack()
        assert raised.value.code == "arabic_stack_missing"
        assert raised.value.details["missing"] == "matplotlib"
        with pytest.raises(ArabicStackMissing):  # typed, never an ImportError
            render_overlay_png(bgr, doc, mask=mask, rendered_at="x")
    finally:
        monkeypatch.undo()
        arabic.reset_stack()
    if arabic.matplotlib_problem() is None:  # restored (unprovable where the OS blocks it)
        assert arabic.stack_status()["ok"]


def test_one_blocked_compiled_module_is_enough(monkeypatch):
    arabic.reset_stack()
    try:
        monkeypatch.setitem(sys.modules, "matplotlib.backends._backend_agg", None)
        problem = arabic.matplotlib_problem()
        assert problem is not None and problem.startswith("matplotlib.backends._backend_agg: ")
        assert arabic.stack_status()["ok"] is False
    finally:
        monkeypatch.undo()
        arabic.reset_stack()


def test_a_stack_checked_ok_earlier_still_gives_a_typed_error(monkeypatch, session):
    # the stack is cached once it was ok; a matplotlib module failing later in the process must
    # still reach finalize as arabic_stack_missing
    doc, bgr, mask = session
    arabic.reset_stack()
    problem = arabic.matplotlib_problem()
    if problem is not None:
        pytest.skip(f"matplotlib cannot be imported here: {problem}")
    arabic.ensure_arabic_stack()
    try:
        monkeypatch.setitem(sys.modules, "matplotlib.figure", None)
        with pytest.raises(ArabicStackMissing) as raised:
            render_overlay_png(bgr, doc, mask=mask, rendered_at="x")
        assert raised.value.details["missing"] == "matplotlib"
    finally:
        monkeypatch.undo()
        arabic.reset_stack()


def test_overlay_without_measurements_or_mask(tmp_path):
    from nazeer_engine.session_schema import empty_document

    doc = empty_document(session_id="20261011_100000_eeeeee")
    bgr = np.full((720, 1280, 3), 200, dtype=np.uint8)
    png, meta = render_overlay_png(bgr, doc, rendered_at="x")
    assert fsio.decode_image(png).shape[:2] == (840, 1280) and meta["n_lines"] == 0
    assert meta["ground_row"] is None
