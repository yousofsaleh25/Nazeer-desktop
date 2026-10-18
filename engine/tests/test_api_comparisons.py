"""D12 F2 over HTTP, driven the way the React + Redux client will drive it (Stage 4)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from nazeer_engine import comparison_model as cm
from nazeer_engine import fsio
from nazeer_engine.api.app import ALLOWED_HEADERS, create_app
from tests.factories import make_candidate
from tests.test_api import MEASUREMENTS, _make_state

PACKAGE = Path(__file__).resolve().parents[1] / "nazeer_engine"
# the app's error-code sweep (app/scripts/gen-engine-codes.mjs, PATTERNS)
CODE_PATTERNS = (
    re.compile(r'\bcode(?:\s*:\s*str)?\s*=\s*"([a-z_]+)"'),
    re.compile(r'"code"\s*:\s*"([a-z_]+)"'),
)


@pytest.fixture
def api(tmp_path: Path):
    state, _bag = _make_state(tmp_path)
    with TestClient(create_app(state)) as client:
        yield client, state


def _finalized(client: TestClient, state, camel_id: str, *, finalize: bool = True) -> dict:
    ref = make_candidate(state.data_root)
    created = client.post("/sessions", json={"candidate": ref, "camel_id": camel_id})
    sid = created.json()["session_id"]
    client.put(
        f"/sessions/{sid}/document",
        json={"revision": 1, "camel_id": camel_id, "measurements": MEASUREMENTS},
    )
    if not finalize:
        return client.get(f"/sessions/{sid}").json()
    view = client.post(f"/sessions/{sid}/finalize", json={"revision": 1})
    assert view.status_code == 200, view.text
    return view.json()


def test_history_rows_say_whether_they_can_join(api):
    client, state = api
    done = _finalized(client, state, "A001")
    draft = _finalized(client, state, "B002", finalize=False)
    client.patch(
        f"/sessions/{done['session_id']}/report-inputs", json={"names": {"event": "مزاين"}}
    )
    rows = {r["session_id"]: r for r in client.get("/sessions").json()["items"]}
    ok = rows[done["session_id"]]
    assert ok["event"] == "مزاين" and ok["n_comparisons"] == 0
    overlay = done["outputs"]["overlay"]
    assert ok["comparison"] == {
        "eligible": True,
        "reason": None,
        "approved_by_seal": False,
        "overlay": {
            "version": 1,
            "sha256": overlay["sha256"],
            "url": f"/sessions/{done['session_id']}/assets/overlay_v1.png?v=1",
        },
    }
    png = client.get(ok["comparison"]["overlay"]["url"]).content
    assert fsio.sha256_bytes(png) == overlay["sha256"]
    assert rows[draft["session_id"]]["comparison"] == {
        "eligible": False,
        "reason": "not_finalized",
        "approved_by_seal": False,
        "overlay": None,
    }
    for internal in ("input_sha256", "overlay_sha256", "report_model_schema", "session_size"):
        assert internal not in ok
    assert client.get("/sessions", params={"event": "مزاين"}).json()["total"] == 1
    assert (
        client.get("/sessions", params={"created_to": "2000-01-01T00:00:00Z"}).json()["total"] == 0
    )
    naive = client.get("/sessions", params={"created_from": "2000-01-01T00:00:00"})
    assert naive.status_code == 200 and naive.json()["total"] == 2
    bad = client.get("/sessions", params={"created_from": "yesterday"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"


def test_create_view_list_patch_delete(api):
    client, state = api
    a = _finalized(client, state, "A001")
    b = _finalized(client, state, "ب٢")
    created = client.post(
        "/comparisons",
        json={
            "session_ids": [b["session_id"], a["session_id"]],
            "cover": {"title": "نهائي", "judge": "Judge A"},
            "language": "ar",
        },
        headers={"X-Electron": "44.4.5", "X-App-Version": "1.0.0"},
    )
    assert created.status_code == 201, created.text
    view = created.json()
    cid = view["comparison_id"]
    assert created.headers["location"] == f"/comparisons/{cid}"
    assert created.headers["cache-control"] == "no-store"
    assert view["status"] == "created" and view["language"] == "ar" and view["index_state"] == "ok"
    assert [m["camel_id"] for m in view["members"]] == ["ب٢", "A001"]
    assert view["cover"] == {"title": "نهائي", "event": "", "judge": "Judge A", "council": ""}
    assert view["stale"] is False and view["report_stale"] is False
    assert view["outputs"]["report"] is None and view["versions"]["electron"] == "44.4.5"
    first = view["members"][0]
    assert first["approved_by_seal"] is False and first["current"]["status"] == "finalized"
    assert first["overlay"]["url"].endswith("overlay_v1.png?v=1")
    model = client.get(view["outputs"]["model"]["url"])
    assert model.status_code == 200 and model.headers["cache-control"] == "no-store"
    assert fsio.sha256_bytes(model.content) == view["outputs"]["model"]["sha256"]
    assert model.json()["comparison_model_version"] == "1.0"
    assert set(view["required_report_texts"]) >= {"طول الجسم", "ب٢", "A001", "نهائي", "Judge A"}
    manifest = client.get(view["outputs"]["manifest_url"]).json()
    assert manifest["history"][0]["event"] == "created"
    # the same shape again; the index state is reported where the row was written (create)
    assert client.get(f"/comparisons/{cid}").json() == {**view, "index_state": None}

    listed = client.get("/comparisons").json()
    assert listed["total"] == 1 and listed["reconciled"]["unchanged"] == 1
    row = listed["items"][0]
    assert row["comparison_url"] == f"/comparisons/{cid}" and row["report_url"] is None
    assert [m["camel_id"] for m in row["members"]] == ["ب٢", "A001"] and row["stale"] is False
    assert client.get("/comparisons", params={"q": "ب٢"}).json()["total"] == 1
    assert client.get("/comparisons", params={"q": "judge a"}).json()["total"] == 1
    assert client.get("/comparisons", params={"stale": "true"}).json()["total"] == 0
    rows = {r["session_id"]: r for r in client.get("/sessions").json()["items"]}
    assert rows[a["session_id"]]["n_comparisons"] == 1

    patched = client.patch(f"/comparisons/{cid}/inputs", json={"cover": {"event": "مزاين"}})
    assert patched.status_code == 200 and patched.json()["outputs"]["model"]["version"] == 2
    assert patched.json()["cover"]["event"] == "مزاين"
    bad = client.patch(f"/comparisons/{cid}/inputs", json={"cover": {"camel": "x"}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"

    client.post(f"/sessions/{a['session_id']}/reopen")
    stale = client.get(f"/comparisons/{cid}").json()
    assert stale["stale"] is True and stale["members"][1]["stale_reasons"] == ["member_reopened"]
    assert client.get("/comparisons", params={"stale": "true"}).json()["total"] == 1

    deleted = client.delete(f"/comparisons/{cid}")
    assert deleted.status_code == 200 and deleted.json()["deleted"] is True
    assert client.get(f"/comparisons/{cid}").status_code == 404
    assert client.get(f"/sessions/{b['session_id']}").status_code == 200  # sessions stay
    assert client.get("/history/stats").json()["comparisons"] == {"count": 0, "bytes": 0}
    assert client.post("/history/rebuild").json()["comparisons_unindexed"] == 0


def test_refusals_and_validation(api):
    client, state = api
    done = _finalized(client, state, "A001")
    draft = _finalized(client, state, "B002", finalize=False)
    refused = client.post(
        "/comparisons", json={"session_ids": [done["session_id"], draft["session_id"]]}
    )
    assert refused.status_code == 409
    error = refused.json()["error"]
    assert error["code"] == "comparison_member_not_final"
    assert error["details"]["members"] == [
        {
            "position": 2,
            "session_id": draft["session_id"],
            "reason": "not_finalized",
            "not_found": False,
            "message": "not_finalized",
        }
    ]
    missing = client.post("/comparisons", json={"session_ids": ["20261017_120000_abcdef"]})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "comparison_member_not_found"
    for body, code in (
        ({"session_ids": []}, "comparison_no_members"),
        ({"session_ids": [done["session_id"]] * 2}, "comparison_duplicate_members"),
        ({"session_ids": ["../x"]}, "validation_error"),
        ({"session_ids": [done["session_id"]], "language": "fr"}, "validation_error"),
        ({"session_ids": [done["session_id"]], "cover": {"title": "x" * 201}}, "validation_error"),
        ({"session_ids": [done["session_id"]], "extra": 1}, "validation_error"),
    ):
        answer = client.post("/comparisons", json=body)
        assert answer.status_code == 422 and answer.json()["error"]["code"] == code, body
    assert client.get("/comparisons/20261017_120000_abcdef").json()["error"]["code"] == (
        "comparison_not_found"
    )
    assert client.get("/comparisons/nope").status_code == 404
    assert client.get("/comparisons/20261017_120000_abcdef/assets/x.txt").status_code == 404
    assert client.delete("/comparisons/20261017_120000_abcdef").status_code == 404


def test_labels_headers_and_reason_keys(api):
    client, _state = api
    labels = client.get("/meta/labels").json()
    assert set(labels["comparison_ineligible"]) == set(cm.INELIGIBLE_REASONS)
    assert set(labels["comparison_stale"]) == set(cm.STALE_REASONS + cm.STALE_NOTES)
    assert set(labels["comparison_statuses"]) == set(cm.COMPARISON_STATUSES)
    assert "X-Comparison-Model-Sha256" in ALLOWED_HEADERS
    # the reasons are labels, never error codes: the app's sweep must not pick them up
    swept: set[str] = set()
    for path in PACKAGE.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for pattern in CODE_PATTERNS:
            swept.update(pattern.findall(text))
    reason_only = (set(cm.INELIGIBLE_REASONS) | set(cm.STALE_REASONS) | set(cm.STALE_NOTES)) - {
        "delete_failed"  # also the session delete's error code
    }
    assert swept.isdisjoint(reason_only), swept & reason_only
