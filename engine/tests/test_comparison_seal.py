"""The comparison seal (D12 F2.9, F2.10): the ordered probes on hand-built PDFs, then the store
and HTTP flow on real sessions (engine-rendered overlays) in an Arabic data root."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pypdf import PdfReader
from starlette.testclient import TestClient

from nazeer_engine import comparison_store as store_module
from nazeer_engine import fsio
from nazeer_engine import pdf_finalize as pf
from nazeer_engine.api.app import create_app
from nazeer_engine.errors import Conflict, NotFound, Unprocessable
from nazeer_engine.jsonsafe import loads_strict
from tests.chromium import comparison_page, find_edge, print_to_pdf
from tests.factories import make_candidate
from tests.pdf_fixture import Page, build_document
from tests.test_api import _make_state
from tests.test_comparison_store import Stores

LATIN = [
    {"id": 1, "kind": "distance_3d", "name": "Body length", "points": [[400, 300], [900, 300]]},
    {"id": 2, "kind": "distance_2d", "name": "Height", "points": [[700, 250], [700, 550]]},
]
COVER = {"title": "Final round", "event": "Mzayen", "judge": "Judge One", "council": "Council"}


# ----- the probe on hand-built PDFs ----------------------------------------------------------


def _image(seed: int, shape=(40, 56)) -> tuple[bytes, np.ndarray]:
    rgb = np.random.default_rng(seed).integers(0, 256, (*shape, 3), dtype=np.uint8)
    return fsio.encode_image(np.ascontiguousarray(rgb[..., ::-1]), ".png"), rgb


def _evidence(n: int) -> tuple[list[pf.MemberEvidence], list[np.ndarray]]:
    members, arrays = [], []
    for k in range(1, n + 1):
        png, rgb = _image(k)
        members.append(
            pf.MemberEvidence(
                position=k,
                session_id=f"20261017_10000{k}_abcde{k}",
                overlay_png=png,
                overlay_name="overlay_v1.png",
                session_json=f'{{"camel": {k}}}'.encode(),
                report_model_json=f'{{"report_model_version": "1.1", "k": {k}}}'.encode(),
                report_model_name="report_model_v1.json",
                texts=(f"Camel{k}", f"Girth{k}", "Body length"),
            )
        )
        arrays.append(rgb)
    return members, arrays


def _document(
    arrays: list[np.ndarray], *, order=None, texts=None, cover_image=None, logo=None
) -> bytes:
    order = order or list(range(len(arrays)))
    cover = Page(
        texts=["Final round", "Judge One"], images=[] if cover_image is None else [cover_image]
    )
    if logo is not None:
        cover.images.insert(0, logo)
    pages = [cover, Page(texts=["Body length", *[f"Girth{k + 1}" for k in order]])]
    for k in order:
        lines = texts[k] if texts else [f"Camel{k + 1}", f"Girth{k + 1}", "Body length"]
        pages.append(Page(images=[arrays[k]], texts=lines))
    pages.append(Page(texts=["Judge One"]))
    return build_document(pages)


def _seal(pdf: bytes, members, **kw):
    kw.setdefault("required", ["Final round", "Judge One", "Body length"])
    return pf.finalize_comparison_pdf(
        pdf, members=members, model_name="comparison_model_v1.json", model_json=b"{}", **kw
    )


def test_ordered_pdf_passes_and_carries_every_members_evidence():
    members, arrays = _evidence(3)
    logo = np.full((30, 30, 3), 200, dtype=np.uint8)
    final, probe = _seal(_document(arrays, logo=logo), members, metadata={"NazeerComparison": "c"})
    assert (
        probe["verdict"] == "PASS" and probe["hard_failures"] == [] and probe["soft_failures"] == []
    )
    assert probe["kind"] == "comparison" and probe["n_members"] == 3 and probe["n_pages"] == 6
    pixel = probe["pixel"]
    assert [(m["page"], m["max_abs_diff"]) for m in pixel["members"]] == [(3, 0), (4, 0), (5, 0)]
    assert pixel["n_decoded"] == 3  # the logo (another size) is never decoded
    assert [m["pages"] for m in probe["text"]["members"]] == [[3, 3], [4, 4], [5, 6]]
    stored = PdfReader(io.BytesIO(final)).attachments
    assert len(stored) == 10 and stored["comparison_model_v1.json"] == [b"{}"]
    first = members[0].prefix()
    assert first == "m01_20261017_100001_abcde1_"
    assert stored[first + "overlay_v1.png"] == [members[0].overlay_png]
    assert stored[first + "report_model_v1.json"] == [members[0].report_model_json]
    assert probe["attachments_ok"] and set(probe["timings_ms"]) >= {"pixel", "text", "total"}
    # the sealed file still passes the probe (the attachments did not touch the images)
    again = pf.ordered_pixel_probe(PdfReader(io.BytesIO(final)), arrays)
    assert again["ok"] and "_matched" in again


def test_out_of_order_thumbnail_and_split_images_are_out_of_place():
    members, arrays = _evidence(3)
    _final, swapped = _seal(_document(arrays, order=[1, 0, 2]), members)
    assert swapped["verdict"] == "DRIFT" and swapped["hard_failures"] == ["overlay_out_of_place"]
    assert [m["reason"] for m in swapped["pixel"]["members"]] == ["", "overlay_out_of_place", ""]
    # camel #1's image also as a cover thumbnail (one shared XObject on two pages)
    _final, thumb = _seal(_document(arrays, cover_image=arrays[0]), members)
    assert thumb["hard_failures"] == ["overlay_out_of_place"]
    assert thumb["pixel"]["members"][0]["pages"] == [1, 3]


def test_drift_and_missing_name_the_member():
    members, arrays = _evidence(3)
    tampered = [a.copy() for a in arrays]
    tampered[1][5, 5, 2] ^= 0x01
    _final, drift = _seal(_document(tampered), members)
    assert drift["hard_failures"] == ["overlay_drift"]
    second = drift["pixel"]["members"][1]
    assert second["reason"] == "overlay_drift" and second["max_abs_diff"] == 1
    assert second["drift_pages"] == [4]
    assert [m["ok"] for m in drift["pixel"]["members"]] == [True, False, True]
    other = _evidence(4)[1][3]  # a fourth camel's image where camel #3's belongs
    _final, missing = _seal(
        build_document([Page(texts=["Final round"]), Page(images=[arrays[0]]), Page()]),
        members,
    )
    assert missing["hard_failures"][0] == "overlay_missing"
    assert [m["reason"] for m in missing["pixel"]["members"]] == [
        "",
        "overlay_missing",
        "overlay_missing",
    ]
    _final, stranger = _seal(
        build_document([Page(images=[arrays[0]]), Page(images=[arrays[1]]), Page(images=[other])]),
        members,
    )
    assert stranger["pixel"]["members"][2]["reason"] == "overlay_drift"


def test_each_members_texts_must_be_in_its_own_pages():
    members, arrays = _evidence(3)
    texts = [
        ["Camel1", "Girth1", "Body length", "Camel2", "Girth2"],  # camel #2's names on #1's page
        ["Body length"],
        ["Camel3", "Girth3", "Body length"],
    ]
    pdf = _document(arrays, texts=texts)
    _final, hard = _seal(pdf, members)
    assert hard["verdict"] == "DRIFT" and hard["hard_failures"] == ["text_probe_failed"]
    text = hard["text"]
    assert text["n_missing"] == 0 and text["n_members_missing"] == 1  # the document has them
    second = text["members"][1]
    assert second["pages"] == [4, 4] and not second["ok"]
    assert {n["name"] for n in second["names"] if not n["ok"]} == {"Camel2", "Girth2"}
    _final, soft = _seal(pdf, members, require_text=False)
    assert soft["verdict"] == "PASS" and soft["soft_failures"] == ["text_probe_failed"]
    _final, cover = _seal(_document(arrays), members, required=["Final round", "Absent title"])
    assert cover["hard_failures"] == ["text_probe_failed"] and cover["text"]["n_missing"] == 1


def test_a_member_whose_image_is_missing_is_left_to_the_pixel_verdict():
    members, arrays = _evidence(2)
    pdf = build_document([Page(texts=["Final round", "Judge One", "Body length"]), Page()])
    _final, probe = _seal(pdf, members)
    assert probe["hard_failures"] == ["overlay_missing"]
    assert [m["checked"] for m in probe["text"]["members"]] == [False, False]
    with pytest.raises(Unprocessable):
        _seal(b"not a pdf", members)


# ----- the store, on real sessions -----------------------------------------------------------


@pytest.fixture
def s(tmp_path: Path) -> Stores:
    root = tmp_path / "بيانات"
    root.mkdir()
    return Stores(root)


def _rgb(png: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(png)) as im:
        return np.asarray(im.convert("RGB"))


def _printed(s: Stores, cid: str, *, order=None, model=None) -> bytes:
    """The comparison as the app's print page would lay it out (cover, table, one section per
    camel with its approved overlay, wells), with Latin texts the fixture's font can extract."""
    record = s.comparisons.load(cid)
    cdir = s.comparisons.comparison_dir(cid)
    model = model or loads_strict(fsio.read_bytes(cdir / record["outputs"]["model_file"]))
    cover = model["cover"]
    pages = [Page(texts=[cover[k] for k in ("title", "event", "judge", "council") if cover[k]])]
    pages.append(Page(texts=[r["name"] for r in model["rows"]]))
    members = model["members"]
    for k in order or range(len(members)):
        member = members[k]
        png = fsio.read_bytes(
            s.sessions.session_dir(member["session_id"]) / member["overlay"]["file"]
        )
        pages.append(
            Page(
                images=[_rgb(png)], texts=[member["camel_id"], *[r["name"] for r in member["rows"]]]
            )
        )
    return build_document(pages)


def _comparison(s: Stores, n: int = 2) -> tuple[dict, list]:
    docs = [s.session(f"Camel{k}", LATIN) for k in range(1, n + 1)]
    record, _ = s.comparisons.create([d.session_id for d in docs], cover=COVER, language="en")
    return record, docs


def test_the_store_seals_and_records_every_member(s: Stores):
    record, docs = _comparison(s)
    cid = record["comparison_id"]
    sealed, probe = s.comparisons.attach_report(
        cid,
        _printed(s, cid),
        expected_model_sha256=record["outputs"]["model_sha256"].upper(),
        app_meta={"electron": "44.4.5", "app_version": "1.0.0"},
    )
    assert probe["verdict"] == "PASS" and probe["attachments_ok"], probe["attachments"]
    assert sealed["status"] == "sealed" and sealed["report_stale"] is False
    outputs = sealed["outputs"]
    assert outputs["report_version"] == 1 and outputs["report_model_version"] == 1
    cdir = s.comparisons.comparison_dir(cid)
    pdf = fsio.read_bytes(cdir / "report_v1.pdf")
    assert fsio.sha256_bytes(pdf) == outputs["report_sha256"] == probe["sha256_out"]
    assert s.comparisons.report_path(cid) == cdir / "report_v1.pdf"
    stored = PdfReader(io.BytesIO(pdf)).attachments
    overlay = f"m01_{docs[0].session_id}_overlay_v1.png"
    assert stored[overlay] == [
        fsio.read_bytes(s.sessions.session_dir(docs[0].session_id) / "overlay_v1.png")
    ]
    assert "comparison_model_v1.json" in stored and len(stored) == 7
    manifest = fsio.read_json(cdir / "comparison.manifest.json")
    assert manifest["files"]["pdf"]["n_pages"] == 4 and manifest["status"] == "sealed"
    assert [m["overlay"]["page"] for m in manifest["members"]] == [3, 4]
    assert all(m["session_json"]["sha256_attached"] for m in manifest["members"])
    assert [m["notes"] for m in manifest["members"]] == [[], []]
    assert manifest["printer"]["electron"] == "44.4.5"
    assert [e["event"] for e in manifest["history"]] == ["created", "exported"]
    states = s.comparisons.member_states(s.comparisons.load(cid))
    assert [st["approved_by_seal"] for st in states] == [True, True]  # its own seal
    row = s.history.get_comparison(cid)
    assert row["status"] == "sealed" and row["report_version"] == 1
    # printed again after a cover change: the old model's print is refused, the new one sealed
    s.comparisons.patch_inputs(cid, cover={"title": "Second print"})
    assert s.comparisons.load(cid)["report_stale"] is True
    with pytest.raises(Conflict) as old:
        s.comparisons.attach_report(
            cid, _printed(s, cid), expected_model_sha256=outputs["model_sha256"]
        )
    assert old.value.code == "comparison_model_mismatch"
    current = s.comparisons.load(cid)
    again, _ = s.comparisons.attach_report(
        cid, _printed(s, cid), expected_model_sha256=current["outputs"]["model_sha256"]
    )
    assert again["outputs"]["report_version"] == 2 and again["outputs"]["report_model_version"] == 2
    assert again["report_stale"] is False
    events = [e["event"] for e in fsio.read_json(cdir / "comparison.manifest.json")["history"]]
    assert events == ["created", "exported", "inputs_changed", "re-exported"]
    assert fsio.read_bytes(cdir / "report_v1.pdf") == pdf  # versions are never rewritten


def test_refusals_before_the_probe_keep_nothing(s: Stores):
    record, docs = _comparison(s)
    cid = record["comparison_id"]
    sha = record["outputs"]["model_sha256"]
    pdf = _printed(s, cid)
    with pytest.raises(Unprocessable) as unnamed:
        s.comparisons.attach_report(cid, pdf, expected_model_sha256=None)
    assert unnamed.value.code == "comparison_model_sha_required"
    overlay = s.sessions.session_dir(docs[1].session_id) / "overlay_v1.png"
    original = overlay.read_bytes()
    overlay.write_bytes(original + b"\0")  # changed on disk, session.json untouched
    with pytest.raises(Conflict) as changed:
        s.comparisons.attach_report(cid, pdf, expected_model_sha256=sha)
    assert changed.value.code == "session_assets_changed"
    assert changed.value.details["members"] == [
        {"position": 2, "session_id": docs[1].session_id, "file": "overlay_v1.png"}
    ]
    overlay.write_bytes(original)
    s.sessions.reopen(docs[0].session_id)
    with pytest.raises(Conflict) as stale:
        s.comparisons.attach_report(cid, pdf, expected_model_sha256=sha)
    assert stale.value.code == "comparison_stale"
    assert stale.value.details["members"][0]["stale_reasons"] == ["member_reopened"]
    cdir = s.comparisons.comparison_dir(cid)
    assert not list(cdir.glob("report_v*.pdf"))
    with pytest.raises(NotFound) as none:
        s.comparisons.report_path(cid)
    assert none.value.code == "report_not_found"


def test_a_refused_print_is_kept_with_its_probe(s: Stores):
    record, _docs = _comparison(s)
    cid = record["comparison_id"]
    pdf = _printed(s, cid, order=[1, 0])
    with pytest.raises(Conflict) as refused:
        s.comparisons.attach_report(
            cid, pdf, expected_model_sha256=record["outputs"]["model_sha256"]
        )
    assert refused.value.code == "overlay_out_of_place"
    kept = refused.value.details["rejected_file"]
    assert store_module.ASSET_RE.match(kept)
    assert fsio.read_bytes(s.comparisons.asset_path(cid, kept)) == pdf
    assert refused.value.details["probe"]["verdict"] == "DRIFT"
    loaded = s.comparisons.load(cid)
    assert loaded["status"] == "created" and loaded["outputs"]["report_version"] == 0
    history = fsio.read_json(s.comparisons.comparison_dir(cid) / "comparison.manifest.json")[
        "history"
    ]
    assert history[-1]["event"] == "report_rejected" and history[-1]["file"] == kept


def test_a_member_changed_during_the_probe_refuses_the_seal(
    s: Stores, monkeypatch: pytest.MonkeyPatch
):
    record, docs = _comparison(s)
    cid = record["comparison_id"]
    real = store_module.finalize_comparison_pdf
    held: list[bool] = []

    def probe_while_a_member_is_reopened(*args, **kwargs):
        lock = s.sessions.lock(docs[1].session_id)
        held.append(lock._is_owned())  # the member locks are released during the probe
        s.sessions.reopen(docs[1].session_id)
        return real(*args, **kwargs)

    monkeypatch.setattr(store_module, "finalize_comparison_pdf", probe_while_a_member_is_reopened)
    pdf = _printed(s, cid)
    with pytest.raises(Conflict) as moved:
        s.comparisons.attach_report(
            cid, pdf, expected_model_sha256=record["outputs"]["model_sha256"]
        )
    assert held == [False]
    assert moved.value.code == "comparison_stale"
    assert moved.value.details["members"] == [
        {"position": 2, "session_id": docs[1].session_id, "stale_reasons": ["member_reopened"]}
    ]
    assert moved.value.details["probe"]["verdict"] == "PASS"
    kept = moved.value.details["rejected_file"]
    assert fsio.read_bytes(s.comparisons.asset_path(cid, kept)) == pdf
    assert s.comparisons.load(cid)["status"] == "created"


# ----- over HTTP ------------------------------------------------------------------------------


def test_upload_and_read_back_over_http(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    state, _bag = _make_state(tmp_path)
    with TestClient(create_app(state)) as client:
        ids = []
        for camel in ("Camel1", "Camel2"):
            created = client.post(
                "/sessions",
                json={"candidate": make_candidate(state.data_root), "camel_id": camel},
            ).json()
            sid = created["session_id"]
            client.put(
                f"/sessions/{sid}/document",
                json={"revision": 1, "camel_id": camel, "measurements": LATIN},
            )
            assert client.post(f"/sessions/{sid}/finalize", json={"revision": 1}).status_code == 200
            ids.append(sid)
        view = client.post(
            "/comparisons", json={"session_ids": ids, "cover": COVER, "language": "en"}
        ).json()
        cid = view["comparison_id"]
        sha = view["outputs"]["model"]["sha256"]
        stores = Stores.__new__(Stores)
        stores.sessions, stores.comparisons = state.store, state.comparisons
        pdf = _printed(stores, cid)
        url = f"/comparisons/{cid}/report"
        headers = {"Content-Type": "application/pdf", "X-Comparison-Model-Sha256": sha}
        wrong_type = client.post(
            url, content=pdf, headers={**headers, "Content-Type": "text/plain"}
        )
        assert wrong_type.status_code == 415
        assert (
            client.post(url, content=pdf, headers={"Content-Type": "application/pdf"}).json()[
                "error"
            ]["code"]
            == "comparison_model_sha_required"
        )
        assert client.get(url).json()["error"]["code"] == "report_not_found"
        swapped = client.post(url, content=_printed(stores, cid, order=[1, 0]), headers=headers)
        assert swapped.status_code == 409
        error = swapped.json()["error"]
        assert error["code"] == "overlay_out_of_place"
        assert client.get(error["details"]["rejected_url"]).status_code == 200
        sealed = client.post(url, content=pdf, headers=headers)
        assert sealed.status_code == 200, sealed.text
        body = sealed.json()
        assert body["probe"]["verdict"] == "PASS" and body["comparison"]["status"] == "sealed"
        report = body["comparison"]["outputs"]["report"]
        assert report["url"] == f"{url}?v=1" and report["stale"] is False
        assert [m["approved_by_seal"] for m in body["comparison"]["members"]] == [True, True]
        got = client.get(report["url"])
        assert got.headers["content-type"] == "application/pdf"
        assert fsio.sha256_bytes(got.content) == report["sha256"]
        assert client.get(f"{url}?v=7").json()["error"]["code"] == "asset_not_found"
        listed = client.get("/comparisons").json()["items"][0]
        assert listed["status"] == "sealed" and listed["report_url"] == f"{url}?v=1"
        monkeypatch.setattr("nazeer_engine.api.routes_comparisons.COMPARISON_PDF_MAX_BYTES", 100)
        too_big = client.post(url, content=pdf, headers=headers)
        assert too_big.status_code == 413
        assert too_big.json()["error"]["code"] == "payload_too_large"


# ----- real Chromium (headless Edge prints like Electron's printToPDF) ----------------------


@pytest.mark.realpdf
def test_real_chromium_arabic_comparison_passes_every_probe(s: Stores, tmp_path: Path):
    if find_edge() is None:
        pytest.skip("realpdf: Microsoft Edge not found")
    arabic = [
        {"id": 1, "kind": "distance_3d", "name": "طول الجسم", "points": [[400, 300], [900, 300]]},
        {
            "id": 2,
            "kind": "distance_2d",
            "name": "ارتفاع السنام",
            "points": [[700, 250], [700, 550]],
        },
        {"id": 3, "kind": "distance_3d", "name": "طول الجسم", "points": [[450, 320], [850, 320]]},
    ]
    docs = [
        s.session("جمل-١", arabic),
        s.session("Shaqha 12", arabic[:2]),
        s.session("مجهم ٣", [*arabic[:1], {**arabic[1], "name": "Hump height"}]),
    ]
    record, _ = s.comparisons.create(
        [d.session_id for d in docs],
        cover={
            "title": "نهائي المزاين",
            "event": "مهرجان الإبل",
            "judge": "الحكم",
            "council": "مجلس",
        },
        language="ar",
    )
    cid = record["comparison_id"]
    model = loads_strict(
        fsio.read_bytes(s.comparisons.comparison_dir(cid) / record["outputs"]["model_file"])
    )
    overlays = {
        d.session_id: fsio.read_bytes(s.sessions.session_dir(d.session_id) / "overlay_v1.png")
        for d in docs
    }
    printed = print_to_pdf(comparison_page(model, overlays), tmp_path / "edge")
    if printed is None:
        pytest.skip("realpdf: Edge did not produce a PDF on this machine")
    sealed, probe = s.comparisons.attach_report(
        cid, printed, expected_model_sha256=record["outputs"]["model_sha256"]
    )
    assert probe["verdict"] == "PASS", (probe["hard_failures"], probe["text"], probe["pixel"])
    assert [m["max_abs_diff"] for m in probe["pixel"]["members"]] == [0, 0, 0]
    pages = [m["page"] for m in probe["pixel"]["members"]]
    assert pages == sorted(pages) and len(set(pages)) == 3
    assert all(m["checked"] and m["ok"] for m in probe["text"]["members"])
    assert probe["fonts"]["ok"] and not probe["fonts"]["type3_present"]
    assert probe["attachments_ok"], probe["attachments"]["reason"]
    assert sealed["status"] == "sealed"


def test_the_image_fingerprint_survives_renumbering():
    """A written file renumbers its objects: the colour space Chromium writes as an indirect
    ``[/ICCBased n 0 R]`` must compare by the profile's bytes (found with headless Edge)."""
    from pypdf import PdfWriter
    from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject

    refs = []
    for padding in (0, 3):
        writer = PdfWriter()
        for _ in range(padding):
            writer._add_object(DecodedStreamObject())
        profile = DecodedStreamObject()
        profile.set_data(b"icc profile bytes")
        refs.append(
            writer._add_object(ArrayObject([NameObject("/ICCBased"), writer._add_object(profile)]))
        )
    assert refs[0].idnum != refs[1].idnum
    assert pf._describe(refs[0]) == pf._describe(refs[1])
    assert "stream:" in pf._describe(refs[0])
