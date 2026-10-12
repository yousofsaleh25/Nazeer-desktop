"""The HTTP API, driven the way the React + Redux client drives it (B16)."""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pypdf import PdfReader
from starlette.testclient import TestClient

from nazeer_engine import arabic, fsio
from nazeer_engine.api import routes_sessions
from nazeer_engine.api.app import create_app
from nazeer_engine.api.state import build_state
from nazeer_engine.jsonsafe import loads_strict
from nazeer_engine.settings import Settings
from tests.factories import make_candidate
from tests.pdf_fixture import build_pdf
from tests.test_candidates import Scenario, _bag_iter_factory, _info, _segmenter

MEASUREMENTS = [
    {"id": 1, "kind": "distance_3d", "name": "طول الجسم", "points": [[400, 300], [900, 300]]},
    {
        "id": 2,
        "kind": "curve_3d",
        "name": "Back curve",
        "points": [[500, 300], [600, 300], [985, 380]],
    },
    {"id": 3, "kind": "distance_2d", "name": "Height 2D", "points": [[700, 250], [700, 550]]},
]


def _make_state(
    tmp_path: Path, *, token: str | None = None, delay_s: float = 0.0, n_raw: int = 1200
):
    root = tmp_path / "بيانات"
    root.mkdir(exist_ok=True)
    bag = tmp_path / "fake.bag"
    if not bag.exists():
        bag.write_bytes(b"\x01" * 65536)
    scenario = Scenario(n_raw, 20)
    settings = Settings(data_root=root, model_path=tmp_path / "none.pt", token=token)
    state = build_state(
        settings,
        segmenter=_segmenter(scenario, delay_s=delay_s),
        bag_iter=_bag_iter_factory(scenario),
        inspect=lambda _p: _info(bag, n_raw),
    )
    return state, bag


@pytest.fixture
def api(tmp_path: Path):
    state, bag = _make_state(tmp_path)
    with TestClient(create_app(state)) as client:
        yield client, state, bag


def _wait_terminal(client: TestClient, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/candidates/jobs/{job_id}").json()
        if snap["terminal"]:
            return snap
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def _session(client: TestClient, state, camel_id: str = "A001") -> dict:
    ref = make_candidate(state.data_root)
    r = client.post("/sessions", json={"candidate": ref, "camel_id": camel_id})
    assert r.status_code == 201, r.text
    return r.json()


# ----- system --------------------------------------------------------------------------------


def test_health_versions_labels(api):
    client, state, _bag = api
    health = client.get("/health")
    assert health.status_code == 200 and health.headers["cache-control"] == "no-store"
    body = health.json()
    assert body["status"] == "ok" and body["model"]["stub"] is True and body["job"] is None
    assert body["data_root"] == str(state.data_root)
    # the stack is ok exactly when matplotlib's compiled modules load (Windows Smart App Control
    # can block them; it did on the dev laptop, 2026-10-12)
    assert body["arabic_stack"]["ok"] == (arabic.matplotlib_problem() is None)
    if body["arabic_stack"]["ok"]:
        assert body["arabic_stack"]["font_pinned"] is True
    versions = client.get("/versions").json()
    assert versions["pyrealsense2"] != "NOT INSTALLED" and versions["engine_version"]
    labels = client.get("/meta/labels").json()
    assert "angle_4point" in labels["input_kinds"] and labels["constants"]["KNN_K"] == 9


def test_error_bodies_are_uniform(api):
    client, _state, _bag = api
    missing = client.get("/no/such/route")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
    bad = client.post("/sessions", json={"candidate": {"fingerprint": "x"}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"
    assert bad.json()["error"]["details"]["errors"]
    unknown = client.get("/sessions/20261011_100000_abcdef")
    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "session_not_found"
    traversal = client.get("/sessions/..%2F..%2Fx")
    assert traversal.status_code == 404


def test_openapi_operation_ids_are_unique_snake_case(api):
    client, _state, _bag = api
    spec = client.get("/openapi.json").json()
    ops = [o["operationId"] for item in spec["paths"].values() for o in item.values()]
    assert len(ops) == len(set(ops)) and all(op == op.lower() and " " not in op for op in ops)
    kinds = spec["components"]["schemas"]["MeasurementInputModel"]["properties"]["kind"]["enum"]
    assert "curve_3d" in kinds and "angle_4point" in kinds
    # review #15: the document says what the wire says — every error is ErrorOut
    for path, item in spec["paths"].items():
        for op in item.values():
            codes = op["responses"]
            assert "500" in codes and "503" in codes, (path, sorted(codes))
            assert ("401" in codes) == (path != "/health"), path
            for code, response in codes.items():
                if code[0] in "45":
                    assert "ErrorOut" in json.dumps(response["content"]), (path, code)
    assert not [n for n in spec["components"]["schemas"] if "ValidationError" in n]


def test_shutdown_calls_the_supervisor_hook(api):
    client, state, _bag = api
    calls: list[int] = []
    state.shutdown = lambda: calls.append(1)
    assert client.post("/system/shutdown").status_code == 202 and calls == [1]


def test_token_and_cors(tmp_path: Path):
    state, _bag = _make_state(tmp_path, token="s3cret")
    with TestClient(create_app(state)) as client:
        assert client.get("/versions").status_code == 401
        assert client.get("/versions").json()["error"]["code"] == "unauthorized"
        assert client.get("/versions", headers={"X-Nazeer-Token": "s3cret"}).status_code == 200
        assert client.get("/versions?token=s3cret").status_code == 200  # <img> / EventSource
        assert client.get("/health").status_code == 200
        pre = client.options(
            "/sessions/x/document",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type,if-match,x-nazeer-token",
            },
        )
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == "http://localhost:5173"
        simple = client.get("/health", headers={"Origin": "http://localhost:5173"})
        assert "etag" in simple.headers.get("access-control-expose-headers", "").lower()
        evil = client.get("/health", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in evil.headers


# ----- step 1: bags --------------------------------------------------------------------------


def test_inspect_and_recent_bags(api):
    client, _state, bag = api
    info = client.post("/bags/inspect", json={"path": str(bag)})
    assert info.status_code == 200 and info.json()["n_frames_estimate"] == 1200
    assert info.json()["cached_candidate_sets"] == []
    recent = client.get("/bags/recent").json()
    assert recent["total"] == 1 and recent["items"][0]["exists"]
    removed = client.request("DELETE", "/bags/recent", params={"path": str(bag)}).json()
    assert removed["total"] == 0


# ----- step 2: candidates --------------------------------------------------------------------


def test_candidate_job_then_grid_assets_and_cache(api):
    client, _state, bag = api
    start = client.post(
        "/candidates/jobs", json={"bag_path": str(bag), "params": {"sample_every": 20}}
    )
    assert start.status_code == 202 and start.json()["cached"] is False
    job = start.json()["job"]
    final = _wait_terminal(client, job["job_id"])
    assert final["state"] == "done" and final["progress_fraction"] == 1.0
    url = f"/candidates/{final['result']['fingerprint']}/{final['result']['params_hash']}"
    grid = client.get(url).json()
    assert (
        grid["n_candidates"] == 12
        and grid["presentation"] == "unordered"
        and grid["frames"] is None
    )
    first = grid["candidates"][0]
    assert first["ref"]["candidate_id"] == first["candidate_id"] and first["urls"][
        "thumb"
    ].endswith("thumb.jpg")
    assert len(client.get(url, params={"include_frames": True}).json()["frames"]) == 60
    thumb = client.get(first["urls"]["thumb"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    cached = client.get(first["urls"]["thumb"], headers={"If-None-Match": thumb.headers["etag"]})
    assert cached.status_code == 304
    stats = client.get(first["urls"]["stats"])
    assert (
        stats.headers["cache-control"] == "no-store"
        and stats.json()["candidate_id"] == first["candidate_id"]
    )
    again = client.post(
        "/candidates/jobs", json={"bag_path": str(bag), "params": {"sample_every": 20}}
    )
    assert (
        again.status_code == 200
        and again.json()["cached"]
        and again.json()["candidates_url"] == url
    )
    with client.stream("GET", f"/candidates/jobs/{job['job_id']}/events") as stream:
        text = "".join(stream.iter_text())
    assert text.startswith("event: progress") and "event: done" in text
    assert client.get("/candidates/jobs/nope").status_code == 404
    assert client.get(f"/candidates/{'a' * 64}/{'b' * 16}").status_code == 404
    bad_asset = client.get(first["urls"]["thumb"].replace("thumb.jpg", "secrets.txt"))
    assert bad_asset.status_code == 404
    assert client.post("/bags/inspect", json={"path": str(bag)}).json()["cached_candidate_sets"]


def test_job_busy_and_cancel(tmp_path: Path):
    state, bag = _make_state(tmp_path, delay_s=0.02, n_raw=6000)
    with TestClient(create_app(state)) as client:
        job = client.post(
            "/candidates/jobs", json={"bag_path": str(bag), "params": {"sample_every": 20}}
        ).json()["job"]
        busy = client.post(
            "/candidates/jobs", json={"bag_path": str(bag), "params": {"sample_every": 10}}
        )
        assert busy.status_code == 409 and busy.json()["error"]["code"] == "job_busy"
        assert client.get("/health").json()["job"]["job_id"] == job["job_id"]
        cancel = client.post(f"/candidates/jobs/{job['job_id']}/cancel")
        assert cancel.status_code == 202 and cancel.json()["state"] in ("cancelling", "cancelled")
        assert _wait_terminal(client, job["job_id"])["state"] == "cancelled"
        bad = client.post(
            "/candidates/jobs", json={"bag_path": str(bag), "params": {"z_mean_min_m": 0.5}}
        )
        assert bad.status_code == 422


# ----- steps 3-5: sessions -------------------------------------------------------------------


def test_session_measure_autosave_and_rebase(api):
    client, state, _bag = api
    view = _session(client, state)
    sid = view["session_id"]
    assert view["status"] == "open" and view["revision"] == 0 and view["measurements"] == []
    assert (
        abs(view["frame"]["z_ref"]["z_ref_m"] - 2.0) < 0.02
        and view["frame"]["ground"]["drawn_row"] == 640
    )
    got = client.get(f"/sessions/{sid}")
    etag0 = got.headers["etag"]
    assert etag0.startswith('"r0-') and client.get(f"/sessions/{sid}").headers["etag"] == etag0
    rgb = client.get(view["frame"]["assets"]["rgb"])
    assert rgb.status_code == 200 and rgb.headers["content-type"] == "image/png"
    assert (
        client.get(
            view["frame"]["assets"]["rgb"], headers={"If-None-Match": rgb.headers["etag"]}
        ).status_code
        == 304
    )
    depth = client.post(f"/sessions/{sid}/depth", json={"u": 985, "v": 380, "seq": 7}).json()
    assert depth["source"] == "knn_snapped_to_mask" and depth["seq"] == 7 and depth["ok"]
    assert depth["basis"]["en"].startswith("snapped to camel")
    outside = client.post(f"/sessions/{sid}/depth", json={"u": -5, "v": 3}).json()
    assert outside["reason"] == "pixel_out_of_image" and outside["depth_m"] is None
    preview = client.post(
        f"/sessions/{sid}/preview", json={"measurement": MEASUREMENTS[0], "seq": 3}
    ).json()
    assert preview["seq"] == 3 and preview["row"]["kind"] == "distance_3d"
    assert preview["row"]["presentation"]["value_text"]["en"].endswith(" m")
    saved = client.put(
        f"/sessions/{sid}/document",
        json={"revision": 1, "camel_id": "A001", "measurements": MEASUREMENTS},
    )
    assert saved.status_code == 200 and saved.headers["etag"].startswith('"r1-')
    assert client.get(f"/sessions/{sid}").headers["etag"] == saved.headers["etag"]
    body = saved.json()
    assert [m["id"] for m in body["measurements"]] == [1, 2, 3]
    assert body["measurements"][1]["input"]["kind"] == "curve_3d"
    assert body["measurements"][1]["presentation"]["n_points_knn"] == 1
    assert body["summary"]["n_measurements"] == 3
    replay = client.put(
        f"/sessions/{sid}/document",
        json={"revision": 1, "camel_id": "A001", "measurements": MEASUREMENTS},
    )
    assert replay.status_code == 200  # a retried save whose response was lost
    stale = client.put(
        f"/sessions/{sid}/document",
        json={"revision": 1, "camel_id": "A001", "measurements": MEASUREMENTS[:1]},
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "stale_revision"
    assert stale.json()["error"]["details"]["current"]["revision"] == 1
    assert len(stale.json()["error"]["details"]["current"]["measurements"]) == 3
    if_match = client.put(
        f"/sessions/{sid}/document",
        json={"revision": 2, "measurements": []},
        headers={"If-Match": etag0},  # based on a view that is no longer current
    )
    assert if_match.status_code == 409 and if_match.json()["error"]["details"]["current"]
    replayed = client.put(  # the stored revision replayed with an old If-Match: still a 200
        f"/sessions/{sid}/document",
        json={"revision": 1, "camel_id": "A001", "measurements": MEASUREMENTS},
        headers={"If-Match": etag0},
    )
    assert replayed.status_code == 200 and replayed.headers["etag"] == saved.headers["etag"]
    nan = client.put(
        f"/sessions/{sid}/document",
        content=(
            b'{"revision": 2, "measurements": '
            b'[{"id": 1, "kind": "distance_2d", "points": [[1, NaN], [2, 2]]}]}'
        ),
        headers={"Content-Type": "application/json"},
    )
    assert nan.status_code == 422 and nan.json()["error"]["code"] == "validation_error"
    extra = client.put(
        f"/sessions/{sid}/document", json={"revision": 2, "measurements": [], "surprise": 1}
    )
    assert extra.status_code == 422
    semantic = client.put(
        f"/sessions/{sid}/document",
        json={
            "revision": 2,
            "measurements": [{"id": 1, "kind": "distance_3d", "points": [[1, 1]]}],
        },
    )
    assert semantic.status_code == 422 and semantic.json()["error"]["code"] == "invalid_measurement"
    assert loads_strict(client.get(f"/sessions/{sid}").content)["revision"] == 1  # no NaN anywhere


def test_finalize_without_matplotlib_is_a_typed_missing_stack(api, monkeypatch):
    client, state, _bag = api
    sid = _session(client, state)["session_id"]
    client.put(f"/sessions/{sid}/document", json={"revision": 1, "measurements": MEASUREMENTS})
    arabic.reset_stack()
    try:
        for name in ("matplotlib", *arabic.MATPLOTLIB_BINARY_MODULES):
            monkeypatch.setitem(sys.modules, name, None)
        response = client.post(f"/sessions/{sid}/finalize", json={"revision": 1})
    finally:
        monkeypatch.undo()
        arabic.reset_stack()
    assert response.status_code == 500, response.text
    error = response.json()["error"]
    assert error["code"] == "arabic_stack_missing" and error["details"]["missing"] == "matplotlib"
    view = client.get(f"/sessions/{sid}").json()
    assert view["status"] == "open" and view["outputs"]["overlay"] is None  # nothing sealed


def test_finalize_report_drift_reopen_history_delete(api):
    client, state, _bag = api
    sid = _session(client, state, camel_id="")["session_id"]
    client.put(f"/sessions/{sid}/document", json={"revision": 1, "measurements": MEASUREMENTS})
    no_camel = client.post(f"/sessions/{sid}/finalize", json={"revision": 1})
    assert no_camel.status_code == 422 and no_camel.json()["error"]["code"] == "camel_id_required"
    sealed = client.post(
        f"/sessions/{sid}/finalize",
        json={
            "revision": 2,
            "document": {"camel_id": "A001", "measurements": MEASUREMENTS},
            "report_inputs": {"language": "both", "names": {"judge": "Judge A"}},
        },
        headers={"X-Electron": "38.1.0", "X-Chromium": "140", "X-App-Version": "0.1.0"},
    )
    assert sealed.status_code == 200, sealed.text
    view = sealed.json()
    assert view["status"] == "finalized" and view["revision"] == 2
    # what the print page must render searchably: names, judge / council / event, camel id
    assert set(view["required_report_texts"]) == {
        "طول الجسم",
        "Back curve",
        "Height 2D",
        "Judge A",
        "A001",
    }
    overlay = view["outputs"]["overlay"]
    png = client.get(overlay["url"]).content
    assert fsio.sha256_bytes(png) == overlay["sha256"] and (
        overlay["width"],
        overlay["height"],
    ) == (1280, 840)
    model = client.get(view["outputs"]["report_model"]["url"]).json()
    assert (
        model["inputs"]["names"]["judge"] == "Judge A" and model["versions"]["electron"] == "38.1.0"
    )
    with Image.open(io.BytesIO(png)) as im:
        rgb = np.asarray(im.convert("RGB")).copy()
    pdf = build_pdf(image_rgb=rgb, texts=["Back curve", "Height 2D", "A001"])
    model_v1 = view["outputs"]["report_model"]
    assert model_v1["version"] == 1 and model_v1["sha256"]
    headers = {
        "Content-Type": "application/pdf",
        "X-Overlay-Sha256": overlay["sha256"],
        "X-Report-Model-Sha256": model_v1["sha256"],
        "X-Electron": "38.1.0",
    }
    no_model = client.post(
        f"/sessions/{sid}/report",
        content=pdf,
        headers={k: v for k, v in headers.items() if k != "X-Report-Model-Sha256"},
    )
    assert no_model.status_code == 422
    assert no_model.json()["error"]["code"] == "report_model_sha_required"
    strict = client.post(f"/sessions/{sid}/report", content=pdf, headers=headers)
    assert strict.status_code == 409 and strict.json()["error"]["code"] == "text_probe_failed"
    wrong_type = client.post(
        f"/sessions/{sid}/report", content=pdf, headers={**headers, "Content-Type": "text/plain"}
    )
    assert wrong_type.status_code == 415
    wrong_sha = client.post(
        f"/sessions/{sid}/report", content=pdf, headers={**headers, "X-Overlay-Sha256": "0" * 64}
    )
    assert (
        wrong_sha.status_code == 409 and wrong_sha.json()["error"]["code"] == "overlay_sha_mismatch"
    )
    tampered = rgb.copy()
    tampered[3, 3, 0] ^= 0x20
    drift = client.post(
        f"/sessions/{sid}/report", content=build_pdf(image_rgb=tampered), headers=headers
    )
    assert drift.status_code == 409 and drift.json()["error"]["code"] == "overlay_drift"
    rejected_url = drift.json()["error"]["details"]["rejected_url"]
    assert client.get(rejected_url).headers["content-type"] == "application/pdf"
    exported = client.post(  # the Latin fixture cannot carry the Arabic name: relax the text probe
        f"/sessions/{sid}/report",
        content=pdf,
        headers=headers,
        params={"require_text": "false"},
    )
    assert exported.status_code == 200, exported.text
    report = exported.json()
    assert report["probe"]["verdict"] == "PASS" and report["session"]["status"] == "exported"
    assert report["probe"]["soft_failures"] == ["text_probe_failed"]
    sealed_report = report["session"]["outputs"]["report"]
    assert sealed_report["stale"] is False and sealed_report["overlay_version"] == 1
    assert sealed_report["report_model_version"] == 1
    final_pdf = client.get(report["session"]["outputs"]["report"]["url"])
    assert final_pdf.headers["content-type"] == "application/pdf"
    assert set(PdfReader(io.BytesIO(final_pdf.content)).attachments) == {
        "overlay_v1.png",
        "session.json",
        "report_model.json",
    }
    stale_inputs = client.patch(
        f"/sessions/{sid}/report-inputs", json={"names": {"event": "مزاين"}}
    ).json()
    assert stale_inputs["report_stale"] is True
    assert stale_inputs["outputs"]["report"]["stale"] is True
    assert stale_inputs["outputs"]["report_model"]["version"] == 2
    old_print = client.post(  # printed from model v1, uploaded after the inputs changed
        f"/sessions/{sid}/report", content=pdf, headers=headers, params={"require_text": "false"}
    )
    assert old_print.status_code == 409
    assert old_print.json()["error"]["code"] == "report_model_mismatch"
    reopened = client.put(
        f"/sessions/{sid}/document",
        json={"revision": 3, "camel_id": "A001", "measurements": MEASUREMENTS[:1]},
    ).json()
    assert reopened["status"] == "open" and reopened["outputs_stale"] is True
    history = client.get("/sessions", params={"q": "A001"}).json()
    assert history["total"] == 1 and history["items"][0]["status"] == "open"
    assert history["items"][0]["thumb_url"].endswith("thumb.jpg")
    assert client.get("/sessions", params={"status": "exported"}).json()["total"] == 0
    assert client.get("/history/stats").json()["sessions"]["count"] == 1
    assert client.post("/history/rebuild").json()["unindexed"] == 1
    backup = client.post("/history/backup", json={}).json()
    assert Path(backup["path"]).is_file() and backup["bytes"] > 0
    assert client.post("/history/backup", json={"path": "relative.sqlite"}).status_code == 422
    deleted = client.delete(f"/sessions/{sid}")
    assert deleted.status_code == 200 and deleted.json()["deleted"]
    assert client.get(f"/sessions/{sid}").status_code == 404


def test_report_upload_size_cap(api, monkeypatch):
    client, state, _bag = api
    sid = _session(client, state)["session_id"]
    monkeypatch.setattr(routes_sessions, "PDF_MAX_BYTES", 100)
    big = client.post(
        f"/sessions/{sid}/report",
        content=b"%PDF-" + b"0" * 500,
        headers={"Content-Type": "application/pdf"},
    )
    assert big.status_code == 413 and big.json()["error"]["code"] == "payload_too_large"


def test_openapi_snapshot_is_current():
    snapshot = Path(__file__).resolve().parents[1] / "openapi.json"
    current = create_app(None).openapi()
    assert snapshot.is_file(), "run: python -m nazeer_engine --dump-openapi openapi.json"
    stored = json.loads(snapshot.read_text(encoding="utf-8"))
    assert stored == json.loads(json.dumps(current)), (
        "API changed: regenerate with `python -m nazeer_engine --dump-openapi openapi.json`"
    )


# ----- review fixes: robustness (stage A) ------------------------------------------------------


def test_unsafe_integer_ids_are_rejected_at_the_boundary(api):
    client, state, _bag = api
    sid = _session(client, state)["session_id"]
    big = {"id": 2**63, "kind": "distance_2d", "points": [[1, 1], [5, 5]]}
    r = client.put(f"/sessions/{sid}/document", json={"revision": 1, "measurements": [big]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.put(f"/sessions/{sid}/document", json={"revision": 2**60, "measurements": []})
    assert r.status_code == 422
    assert client.get("/sessions").status_code == 200  # History still lists


def test_unexpected_errors_are_uniform_json_with_cors(api, monkeypatch):
    client, state, _bag = api
    sid = _session(client, state)["session_id"]

    def boom(_session_id):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(state.store, "load", boom)
    r = client.get(f"/sessions/{sid}", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_interactive_docs_are_dev_only(tmp_path, monkeypatch):
    state, _bag = _make_state(tmp_path)
    monkeypatch.delenv("NAZEER_ENGINE_DEV", raising=False)
    with TestClient(create_app(state)) as client:
        assert client.get("/docs").status_code == 404  # would load Swagger UI from a CDN
        assert client.get("/openapi.json").status_code == 200


def test_backup_to_an_unusable_path_is_a_clear_error(api, tmp_path):
    client, _state, _bag = api
    blocker = tmp_path / "a_file"
    blocker.write_bytes(b"x")
    r = client.post("/history/backup", json={"path": str(blocker / "sub" / "h.sqlite")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "backup_failed"


def test_candidate_vanishing_mid_copy_is_a_404(api, monkeypatch):
    client, state, _bag = api
    from nazeer_engine import session_store

    def vanish(_src, _dst):
        raise FileNotFoundError("rgb.png")

    monkeypatch.setattr(session_store, "copy_bundle", vanish)
    ref = make_candidate(state.data_root)
    r = client.post("/sessions", json={"candidate": ref, "camel_id": "A001"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "candidate_not_found"
    assert not any((state.data_root / "sessions").iterdir())  # the half-made folder is gone


def test_assets_are_sent_from_memory_without_ranges(api):
    client, state, _bag = api
    view = _session(client, state)
    first = client.get(view["frame"]["assets"]["mask"])
    assert first.status_code == 200 and first.headers["accept-ranges"] == "none"
    assert first.headers["etag"] == f'"{fsio.sha256_bytes(first.content)}"'
    again = client.get(
        view["frame"]["assets"]["mask"], headers={"If-None-Match": first.headers["etag"]}
    )
    assert again.status_code == 304 and again.content == b""
