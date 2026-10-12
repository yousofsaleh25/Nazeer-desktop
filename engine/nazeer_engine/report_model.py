"""``report_model.json`` — everything the React print page typesets (ADR-D7, B7, B22).

The engine computes; the print page only lays out. Each measurement row carries the
bilingual kind label, the value and uncertainty texts, the per-point "Depth basis"
strings, flag chips, confidence and any rejection, so the PDF shows exactly what the
canvas showed. Static content (certification, the empty Mzayen form, the 27 regions,
observation fields, signature wells) is included as data. No beauty score anywhere.

Version 1.1 adds the texts the page had to compose itself in 1.0: the frame block (Z_ref,
ground line, depth-valid region, model, intrinsics, candidate, source frame), a 3D curve's
2D cross-check, a 4-point angle's lines, the counts line, and their labels (static). Every
number in them is formatted here; a missing value prints as "--", never as a made-up 0.
"""

from __future__ import annotations

import math
from typing import Any

from . import labels, report_content
from .constants import ENGINE_VERSION, REPORT_MODEL_VERSION
from .session_compute import present_rows, summarize
from .session_schema import SessionDocument, iso_now

Label = dict[str, str]

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

STATISTIC_LABELS: dict[str, Label] = {"median": {"ar": "وسيط", "en": "median"}}


def _num(value: Any, spec: str) -> str:
    """A finite number in ``spec``; "--" when it is missing or not a number."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "--"
    if not math.isfinite(value):
        return "--"
    if spec in ("d", ","):
        return format(round(value), spec)
    return format(value, spec)


def _same(text: str) -> Label:
    return {"ar": text, "en": text}


def frame_texts(frame: dict[str, Any]) -> dict[str, Label]:
    """The frame block's values, one bilingual text per row of ``static.frame_rows``, plus
    ``source`` (read index, bag time, bucket; the bag file name is printed beside it)."""
    z = frame.get("z_ref") or {}
    g = frame.get("ground") or {}
    k = frame.get("intrinsics") or {}
    model = frame.get("model") or {}
    cand = frame.get("candidate") or {}
    stat = labels.label(STATISTIC_LABELS, str(z.get("statistic") or "--"))
    z_m = _num(z.get("z_ref_m"), ".3f")
    n_valid, n_total = _num(z.get("n_valid"), ","), _num(z.get("n_total"), ",")
    erosion, share = _num(z.get("erosion_px"), "d"), _num(z.get("valid_fraction"), ".1%")
    mad = _num(z.get("z_mad_robust_m"), ".3f")
    z_ref = {
        "ar": (
            f"{z_m} م: {stat['ar']} {n_valid} قيمة عمق صالحة في القناع بعد تقليصه {erosion} "
            f"بكسل ({share} من {n_total} بكسل)، MAD {mad} م"
        ),
        "en": (
            f"{z_m} m: {stat['en']} of {n_valid} valid depths in the mask eroded by {erosion} px "
            f"({share} of {n_total} px), robust MAD {mad} m"
        ),
    }
    drawn, near, raw = (_num(g.get(key), "d") for key in ("drawn_row", "near_plane_row", "raw_row"))
    ground = {
        "ar": f"الصف {drawn} هو المرسوم (صف المستوى القريب {near}، أدنى صف خام {raw})",
        "en": f"row {drawn} drawn (near-plane row {near}, raw lowest row {raw})",
    }
    if g.get("badge"):
        badge = labels.label(labels.GROUND_BADGE_LABELS, str(g["badge"]))
        ground = {"ar": f"{ground['ar']} · {badge['ar']}", "en": f"{ground['en']} · {badge['en']}"}
    box = list(frame.get("depth_valid_bbox") or [])
    x0, y0, x1, y1 = (_num(v, "d") for v in (box + [None] * 4)[:4])
    depth_bbox = {
        "ar": f"x {x0}–{x1}، y {y0}–{y1} بكسل",
        "en": f"x {x0}–{x1}, y {y0}–{y1} px",
    }
    sha = str(model.get("sha256") or "--")
    model_text = _same(f"{model.get('file') or '--'} · sha256 {sha[:16]}…")
    if model.get("stub"):
        model_text = {
            "ar": f"{model_text['ar']} · نموذج بديل للتطوير",
            "en": f"{model_text['en']} · development stub model",
        }
    fx, fy, cx, cy = (_num(k.get(key), ".1f") for key in ("fx", "fy", "cx", "cy"))
    intrinsics = {
        "ar": (
            f"fx {fx}، fy {fy}، cx {cx}، cy {cy} بكسل؛ تشوّه العدسة مسجَّل ولا يُطبَّق (نموذج ثقب الإبرة)"
        ),
        "en": (
            f"fx {fx}, fy {fy}, cx {cx}, cy {cy} px; lens distortion recorded, not applied "
            "(pinhole model)"
        ),
    }
    cid = str(cand.get("candidate_id") or "--")
    n_cand, z_var = _num(cand.get("n_candidates"), "d"), _num(cand.get("z_var"), ".4f")
    rel = _num(cand.get("rel_disp"), ".3f")
    candidate = {
        "ar": (
            f"{cid} · الإطارات المقترحة {n_cand} · تباين العمق (MSE) {z_var} م² · "
            f"التشتت النسبي {rel}"
        ),
        "en": (
            f"{cid} · {n_cand} frames proposed · depth MSE {z_var} m² · relative dispersion {rel}"
        ),
    }
    index, t = _num(frame.get("read_index"), "d"), _num(frame.get("bag_time_s"), ".2f")
    bucket = labels.label(labels.BUCKET_LABELS, str(frame.get("bucket") or "--"))
    source = {
        "ar": f"مؤشر القراءة {index} · t = {t} ث · {bucket['ar']}",
        "en": f"read index {index} · t = {t} s · {bucket['en']}",
    }
    return {
        "z_ref": z_ref,
        "ground": ground,
        "depth_bbox": depth_bbox,
        "model": model_text,
        "intrinsics": intrinsics,
        "candidate": candidate,
        "source": source,
    }


def counts_text(summary: dict[str, Any]) -> Label:
    n = _num(summary.get("n_measurements"), "d")
    rejected = _num(summary.get("n_rejected"), "d")
    low = _num(summary.get("n_low_confidence"), "d")
    return {
        "ar": f"القياسات: {n} · المرفوضة: {rejected} · منخفضة الثقة: {low}",
        "en": f"Measurements: {n} · rejected: {rejected} · low confidence: {low}",
    }


def lines_text(line_a_id: Any, line_b_id: Any) -> Label:
    return {
        "ar": f"بين القياسين #{line_a_id} و#{line_b_id}",
        "en": f"between #{line_a_id} and #{line_b_id}",
    }


def cross_check_text(curve: dict[str, Any]) -> Label:
    check = curve.get("cross_check_2d_m")
    n_seg = _num(len(curve.get("segment_lengths_m") or []), "d")
    flagged = _num(curve.get("n_flagged_segments") or 0, "d")
    return {
        "ar": (
            f"تحقق ثنائي الأبعاد {labels.fmt_len(check, 'ar')} · المقاطع {n_seg}، "
            f"عليها تنبيه {flagged}"
        ),
        "en": f"2D cross-check {labels.fmt_len(check, 'en')} · {n_seg} segments, {flagged} flagged",
    }


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
        out["curve"]["cross_check_text"] = cross_check_text(out["curve"])
    if row["kind"] in ("angle_3d_4point", "angle_2d_4point"):
        a, b = row.get("line_a_id"), row.get("line_b_id")
        out["lines"] = {"a": a, "b": b, "text": lines_text(a, b)}
    return out


def build_report_model(
    doc: SessionDocument,
    *,
    overlay: dict[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    rows = present_rows(doc)
    summary = summarize(doc)
    summary["counts_text"] = counts_text(summary)
    meta = doc.frame_metadata
    view = doc.frame_view
    inputs = doc.report_inputs.to_dict()
    wells = []
    for well in report_content.SIGNATURE_WELLS:
        name_key = "judge" if well["id"] == "judge" else "council"
        wells.append({**well, "name": inputs["names"].get(name_key, "")})
    frame = {
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
    }
    frame["texts"] = frame_texts(frame)
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
        "frame": frame,
        "overlay": dict(overlay),
        "measurements": [_report_row(r) for r in rows],
        "summary": summary,
        "static": report_content.static_content(inputs["rubric_variant"]),
        "signature_wells": wells,
        "versions": dict(doc.library_versions),
        "constants": dict((doc.engine or {}).get("constants") or {}),
    }
