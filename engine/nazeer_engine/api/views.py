"""Response bodies built from engine objects (shapes documented in ``api.schemas``)."""

from __future__ import annotations

from typing import Any

from ..session_compute import present_rows, summarize
from ..session_schema import SessionDocument, document_etag, required_report_texts


def session_base(session_id: str) -> str:
    return f"/sessions/{session_id}"


def session_view(doc: SessionDocument, *, index_state: str | None = None) -> dict[str, Any]:
    """The single session shape every session endpoint returns (B16)."""
    base = session_base(doc.session_id)
    meta = doc.frame_metadata
    view = doc.frame_view
    out = doc.outputs
    overlay = None
    if out.overlay_file and out.overlay_sha256:
        overlay = {
            "version": out.overlay_version,
            "file": out.overlay_file,
            "sha256": out.overlay_sha256,
            "width": out.overlay_width,
            "height": out.overlay_height,
            "url": f"{base}/assets/{out.overlay_file}?v={out.overlay_version}",
        }
    report_model = None
    if out.report_model_file:
        report_model = {
            "version": out.report_model_version,
            "file": out.report_model_file,
            "sha256": out.report_model_sha256,
            "url": f"{base}/assets/{out.report_model_file}",
        }
    report = None
    if out.report_file:
        report = {
            "version": out.report_version,
            "file": out.report_file,
            "sha256": out.report_sha256,
            "url": f"{base}/report?v={out.report_version}",
            # what it was sealed with; ``stale`` = it no longer shows the current outputs
            "overlay_version": out.report_overlay_version,
            "report_model_version": out.report_model_version_sealed,
            "stale": bool(doc.report_stale or doc.outputs_stale),
        }
    return {
        "session_id": doc.session_id,
        "camel_id": doc.camel_id,
        "operator": doc.operator,
        "notes": doc.notes,
        "status": doc.status,
        "revision": doc.revision,
        "outputs_stale": doc.outputs_stale,
        "report_stale": doc.report_stale,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
        "next_measurement_id": doc.next_measurement_id,
        "measurements": present_rows(doc),
        "summary": summarize(doc),
        "frame": {
            "width": meta.get("width"),
            "height": meta.get("height"),
            "z_ref": meta.get("z_ref") or {},
            "ground": meta.get("ground") or {},
            "depth_valid_bbox": meta.get("depth_valid_bbox"),
            "knn": meta.get("knn") or {},
            "intrinsics": meta.get("intrinsics") or {},
            "candidate": meta.get("candidate") or {},
            "model": meta.get("model") or {},
            "bag": {
                "name": view.get("bag_name"),
                "path": view.get("bag_path"),
                "fingerprint": view.get("bag_fingerprint"),
                "read_index": view.get("read_index"),
                "frame_number_color": view.get("frame_number_color"),
                "frame_number_depth": view.get("frame_number_depth"),
                "bag_time_s": view.get("bag_time_s"),
                "bucket": view.get("bucket"),
            },
            "assets": {
                "rgb": f"{base}/assets/rgb.png",
                "mask": f"{base}/assets/mask.png",
                "thumb": f"{base}/assets/thumb.jpg",
                "depth": f"{base}/assets/depth.npy",
            },
        },
        "outputs": {
            "overlay": overlay,
            "report_model": report_model,
            "report": report,
            "manifest_url": f"{base}/assets/report.manifest.json" if out.manifest_file else None,
        },
        "report_inputs": doc.report_inputs.to_dict(),
        "required_report_texts": required_report_texts(doc),
        "library_versions": dict(doc.library_versions),
        "index_state": index_state,
    }


def session_etag(doc: SessionDocument) -> str:
    """``"r<revision>-<hash>"``: changes with any persisted change (status, outputs, ...)."""
    return document_etag(doc)


def candidate_urls(fingerprint: str, params_hash: str, candidate_id: str) -> dict[str, str]:
    base = f"/candidates/{fingerprint}/{params_hash}/{candidate_id}"
    return {
        "thumb": f"{base}/thumb.jpg",
        "rgb": f"{base}/rgb.png",
        "mask": f"{base}/mask.png",
        "depth": f"{base}/depth.npy",
        "intrinsics": f"{base}/intrinsics.json",
        "stats": f"{base}/stats.json",
    }


def candidate_set_view(
    data: dict[str, Any], fingerprint: str, params_hash: str, *, include_frames: bool
) -> dict[str, Any]:
    out = {key: value for key, value in data.items() if key != "frames"}
    out["fingerprint"] = fingerprint
    out["params_hash"] = params_hash
    candidates = []
    for cand in data.get("candidates", []):
        item = {k: v for k, v in cand.items() if k not in ("assets", "bytes")}
        cid = str(cand.get("candidate_id"))
        item["urls"] = candidate_urls(fingerprint, params_hash, cid)
        item["ref"] = {"fingerprint": fingerprint, "params_hash": params_hash, "candidate_id": cid}
        candidates.append(item)
    out["candidates"] = candidates
    out["frames"] = data.get("frames") if include_frames else None
    for key, default in (
        ("selection", {}),
        ("near_misses", []),
        ("shortfall_reasons", []),
        ("warnings", []),
        ("rejected_by_reason", {}),
    ):
        out.setdefault(key, default)
    return out


def history_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out.pop("session_mtime_ns", None)
    out.pop("session_size", None)
    base = session_base(row["session_id"])
    out["session_url"] = base
    out["thumb_url"] = (
        f"{base}/assets/thumb.jpg" if row.get("index_state") != "missing_files" else None
    )
    return out
