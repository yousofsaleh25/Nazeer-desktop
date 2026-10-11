from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from pypdf import PdfReader

from nazeer_engine import fsio
from nazeer_engine import pdf_finalize as pf
from nazeer_engine.errors import Unprocessable
from tests.chromium import find_edge, print_to_pdf, report_page
from tests.pdf_fixture import build_pdf


def _overlay(seed: int = 0, shape=(48, 64)) -> tuple[bytes, np.ndarray]:
    rgb = np.random.default_rng(seed).integers(0, 256, (*shape, 3), dtype=np.uint8)
    png = fsio.encode_image(np.ascontiguousarray(rgb[..., ::-1]), ".png")  # cv2 wants BGR
    return png, rgb


def _finalize(pdf: bytes, png: bytes, **kw):
    kw.setdefault("names", [])
    return pf.finalize_pdf(
        pdf,
        overlay_png=png,
        overlay_name="overlay_v1.png",
        session_json=b'{"schema_version": "2.1"}',
        report_model_json=b'{"report_model_version": "1.0"}',
        **kw,
    )


def test_matching_pdf_passes_and_is_sealed_with_attachments():
    png, rgb = _overlay()
    pdf = build_pdf(image_rgb=rgb, texts=["Body length 1.554 m"])
    final, probe = _finalize(pdf, png, names=["Body length"], metadata={"NazeerSession": "s1"})
    assert (
        probe["verdict"] == "PASS" and probe["hard_failures"] == [] and probe["soft_failures"] == []
    )
    assert probe["pixel"]["match"]["max_abs_diff"] == 0 and probe["pixel"]["ok"]
    assert probe["text"]["ok"] and probe["fonts"]["ok"] and probe["attachments_ok"]
    reader = PdfReader(io.BytesIO(final))
    stored = reader.attachments
    assert set(stored) == {"overlay_v1.png", "session.json", "report_model.json"}
    assert stored["overlay_v1.png"][0] == png
    assert reader.metadata["/Producer"].startswith("Nazeer Engine")
    assert reader.metadata["/NazeerSession"] == "s1"
    assert probe["sha256_out"] != probe["sha256_in"] and probe["n_pages"] == 1


def test_one_changed_pixel_is_overlay_drift():
    png, rgb = _overlay()
    tampered = rgb.copy()
    tampered[10, 10, 0] ^= 0x01
    _final, probe = _finalize(build_pdf(image_rgb=tampered), png)
    assert probe["verdict"] == "DRIFT" and probe["hard_failures"] == ["overlay_drift"]
    assert probe["pixel"]["min_abs_diff"] == 1


def test_resized_or_absent_overlay_is_overlay_missing():
    png, _rgb = _overlay()
    _, other = _overlay(seed=1, shape=(24, 32))
    assert _finalize(build_pdf(image_rgb=other), png)[1]["hard_failures"] == ["overlay_missing"]
    assert _finalize(build_pdf(image_rgb=None), png)[1]["hard_failures"] == ["overlay_missing"]


def test_text_and_font_probes_are_soft_unless_required():
    png, rgb = _overlay()
    pdf = build_pdf(image_rgb=rgb, texts=["Body length"], plex_basefont=None)
    _final, soft = _finalize(pdf, png, names=["Body length", "Hump height"])
    assert soft["verdict"] == "PASS"
    assert soft["soft_failures"] == ["text_probe_failed", "font_probe_failed"]
    missing = [n for n in soft["text"]["names"] if not n["ok"]]
    assert [n["name"] for n in missing] == ["Hump height"]
    _final, hard = _finalize(pdf, png, names=["Hump height"], require_text=True, require_font=True)
    assert hard["verdict"] == "DRIFT"
    assert hard["hard_failures"] == ["text_probe_failed", "font_probe_failed"]


def test_not_a_pdf_and_truncated_pdf_are_422():
    png, rgb = _overlay()
    with pytest.raises(Unprocessable) as info:
        _finalize(b"hello", png)
    assert info.value.code == "not_a_pdf"
    with pytest.raises(Unprocessable):
        _finalize(build_pdf(image_rgb=rgb)[:120], png)
    with pytest.raises(Unprocessable):
        _finalize(b"", png)


def test_normalisation_and_script_runs():
    assert pf.normalize_text("ﻃﻮﻝ ﺍﻟﺠﺴﻢ") == "طولالجسم"  # presentation forms -> letters
    assert pf.normalize_text("قُرِّبت") == "قربت"  # harakat stripped
    assert pf.normalize_text("\u2068طول\u2069 \u200e1") == "طول1"  # bidi controls stripped
    assert pf.name_runs("Ahmed أحمد 12") == ["Ahmed", "أحمد", "12"]
    assert pf.name_runs("جمل-7") == ["جمل", "7"]  # punctuation placement is bidi-dependent
    assert pf.name_runs("قُرِّبت") == ["قربت"]  # harakat do not split a word
    assert pf.name_runs("(KNN) 2.0") == ["KNN", "2", "0"]
    assert pf.name_runs("   ") == []


def test_text_probe_accepts_chromium_reordered_mixed_names():
    class Page:
        def __init__(self, text: str) -> None:
            self._text = text

        def extract_text(self) -> str:
            return self._text

    class Reader:
        pages = [Page("12 ﺃﺣﻤﺪ Ahmed and ﻃﻮﻝ ﺍﻟﺠﺴﻢ")]

    probe = pf.text_probe(Reader(), ["Ahmed أحمد 12", "طول الجسم", "absent"])
    oks = {n["name"]: n["ok"] for n in probe["names"]}
    assert oks == {"Ahmed أحمد 12": True, "طول الجسم": True, "absent": False}


# ----- real Chromium (headless Edge prints like Electron's printToPDF) ----------------------


@pytest.mark.realpdf
def test_real_chromium_pdf_passes_every_probe(tmp_path: Path):
    if find_edge() is None:
        pytest.skip("realpdf: Microsoft Edge not found")
    png, _rgb = _overlay(seed=7, shape=(840, 1280))
    names = ["طول الجسم", "منحنى الظهر", "Ahmed أحمد 12", "جمل-7", "Height 2D"]
    page = report_page(png, [(n, "1.554 m") for n in names], title="تقرير قياس جمال الإبل")
    printed = print_to_pdf(page, tmp_path)
    if printed is None:
        pytest.skip("realpdf: Edge did not produce a PDF on this machine")
    final, probe = _finalize(printed, png, names=names, require_text=True, require_font=True)
    assert probe["pixel"]["ok"] and probe["pixel"]["match"]["max_abs_diff"] == 0, probe["pixel"]
    assert probe["fonts"]["ok"], probe["fonts"]
    assert probe["text"]["ok"], probe["text"]["names"]
    assert probe["verdict"] == "PASS" and probe["attachments_ok"]
    assert len(PdfReader(io.BytesIO(final)).attachments) == 3
    assert not probe["fonts"]["type3_present"] and probe["hints"] == []


@pytest.mark.realpdf
def test_real_chromium_synthesized_bold_names_are_unsearchable_and_hinted(tmp_path: Path):
    """Names in a bold heading with only the Regular face embedded: Chromium fakes the bold
    as Type3 glyphs whose text comes out in visual order — the probe fails and says why."""
    if find_edge() is None:
        pytest.skip("realpdf: Microsoft Edge not found")
    png, _rgb = _overlay(seed=3, shape=(120, 160))
    names = ["الحكم", "مزاين الإبل"]
    bold = print_to_pdf(
        report_page(png, [], title=" — ".join(names), heading_weight="bold"), tmp_path / "b"
    )
    regular = print_to_pdf(report_page(png, [], title=" — ".join(names)), tmp_path / "r")
    if bold is None or regular is None:
        pytest.skip("realpdf: Edge did not produce a PDF on this machine")
    _final, faked = _finalize(bold, png, names=names, require_text=True)
    assert faked["verdict"] == "DRIFT" and faked["hard_failures"] == ["text_probe_failed"]
    assert faked["fonts"]["type3_present"]
    assert [h["code"] for h in faked["hints"]] == ["synthesized_face"]
    _final, fine = _finalize(regular, png, names=names, require_text=True)
    assert fine["verdict"] == "PASS" and not fine["fonts"]["type3_present"]
