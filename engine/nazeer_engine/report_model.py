"""``report_model.json`` — everything the React print page typesets (ADR-D7, B7, B22).

The engine computes; the print page only lays out. Each measurement row carries the
bilingual kind label, the value and uncertainty texts, the per-point "Depth basis"
strings, flag chips, confidence and any rejection, so the PDF shows exactly what the
canvas showed. Static content (certification, the empty Mzayen form, the 27 regions,
observation fields, signature wells) is included as data. No beauty score anywhere.
"""

from __future__ import annotations

from typing import Any

from . import report_content
from .constants import ENGINE_VERSION, REPORT_MODEL_VERSION
from .session_compute import present_rows, summarize
from .session_schema import SessionDocument, iso_now

ROW_KEYS: tuple[str, ...] = (
    "id",
    "order",
    "kind",
    "input_kind",
    "name",
    "note",
    "display_color",
    "targets",
    "rejection_reason",
    "confidence",
    "uncertainty_m",
    "uncertainty_basis",
)


def _report_row(row: dict[str, Any]) -> dict[str, Any]:
    pres = row["presentation"]
    out = {key: row.get(key) for key in ROW_KEYS}
    out.update(
        {
            "family": row["family"],
            "kind_label": pres["kind_label"],
            "value": pres["value"],
            "unit": pres["unit"],
            "value_text": pres["value_text"],
            "uncertainty_text": pres["uncertainty_text"],
            "depth_basis": pres["depth_basis"],
            "flags": pres["flags"],
            "confidence_label": pres["confidence"],
            "rejected": pres["rejected"],
            "rejection": pres["rejection"],
            "n_points": pres["n_points"],
            "n_points_knn": pres["n_points_knn"],
        }
    )
    if row["kind"] == "curve_3d":
        out["curve"] = {
            "cross_check_2d_m": row.get("cross_check_2d_m"),
            "n_flagged_segments": row.get("n_flagged"),
            "segment_lengths_m": row.get("segment_lengths_m"),
            "segment_dz_m": row.get("segment_dz_m"),
            "segment_flags": row.get("segment_flags"),
        }
    if row["kind"] in ("angle_3d_4point", "angle_2d_4point"):
        out["lines"] = {"a": row.get("line_a_id"), "b": row.get("line_b_id")}
    return out


def build_report_model(
    doc: SessionDocument,
    *,
    overlay: dict[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    rows = present_rows(doc)
    summary = summarize(doc)
    meta = doc.frame_metadata
    view = doc.frame_view
    inputs = doc.report_inputs.to_dict()
    wells = []
    for well in report_content.SIGNATURE_WELLS:
        name_key = "judge" if well["id"] == "judge" else "council"
        wells.append({**well, "name": inputs["names"].get(name_key, "")})
    return {
        "report_model_version": REPORT_MODEL_VERSION,
        "engine_version": ENGINE_VERSION,
        "generated_at": generated_at or iso_now(),
        "inputs": inputs,
        "session": {
            "session_id": doc.session_id,
            "camel_id": doc.camel_id,
            "operator": doc.operator,
            "notes": doc.notes,
            "status": doc.status,
            "revision": doc.revision,
            "created_at": doc.created_at,
            "updated_at": doc.updated_at,
        },
        "frame": {
            "width": meta.get("width"),
            "height": meta.get("height"),
            "bag_name": view.get("bag_name"),
            "bag_path": view.get("bag_path"),
            "bag_fingerprint": view.get("bag_fingerprint"),
            "read_index": view.get("read_index"),
            "frame_number_color": view.get("frame_number_color"),
            "frame_number_depth": view.get("frame_number_depth"),
            "color_timestamp_ms": view.get("color_timestamp_ms"),
            "bag_time_s": view.get("bag_time_s"),
            "bucket": view.get("bucket"),
            "z_ref": meta.get("z_ref"),
            "ground": meta.get("ground"),
            "depth_valid_bbox": meta.get("depth_valid_bbox"),
            "intrinsics": meta.get("intrinsics"),
            "knn": meta.get("knn"),
            "model": meta.get("model"),
            "candidate": meta.get("candidate"),
        },
        "overlay": dict(overlay),
        "measurements": [_report_row(r) for r in rows],
        "summary": summary,
        "static": report_content.static_content(inputs["rubric_variant"]),
        "signature_wells": wells,
        "versions": dict(doc.library_versions),
        "constants": dict((doc.engine or {}).get("constants") or {}),
    }
