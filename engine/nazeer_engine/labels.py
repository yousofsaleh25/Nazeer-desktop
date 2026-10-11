"""One bilingual (Arabic / English) dictionary for every code the engine emits.

The live canvas (via ``GET /meta/labels`` and the presentation fields of every row), the
overlay PNG and the PDF report all read their wording from here, so the judge sees the
same words while measuring and on the signed report.
"""

from __future__ import annotations

import math
from typing import Any

from .constants import (
    ENDPOINT_DZ_FLAG_FRAC,
    KNN_FAR_M,
    KNN_K,
    KNN_MAX_DIST_M,
    KNN_RING_EXCLUDE_PX,
    Z_MEAN_MIN_M,
)
from .provenance import HARD_REJECTIONS, SOFT_FLAGS, SOURCES

Label = dict[str, str]

KINDS: dict[str, Label] = {
    "distance_2d": {"ar": "مسافة ثنائية الأبعاد (مستوى Z_ref)", "en": "2D distance (Z_ref plane)"},
    "distance_3d": {"ar": "مسافة ثلاثية الأبعاد", "en": "3D distance"},
    "curve_2d": {
        "ar": "طول خط منكسر ثنائي الأبعاد (مستوى Z_ref)",
        "en": "2D polyline length (Z_ref plane)",
    },
    "curve_3d": {"ar": "طول خط منكسر ثلاثي الأبعاد", "en": "3D polyline length"},
    "angle_3d_4point": {
        "ar": "زاوية بين خطين (ثلاثية الأبعاد)",
        "en": "Angle between two lines (3D)",
    },
    "angle_2d_4point": {
        "ar": "زاوية بين خطين (ثنائية الأبعاد)",
        "en": "Angle between two lines (2D)",
    },
    "angle_2d_3point": {"ar": "زاوية بثلاث نقاط (ثنائية الأبعاد)", "en": "3-point angle (2D)"},
    "angle_3d_3point": {"ar": "زاوية بثلاث نقاط (ثلاثية الأبعاد)", "en": "3-point angle (3D)"},
    "angle_2d_from_horizontal": {"ar": "زاوية مع الأفق", "en": "Angle vs horizontal"},
}
INPUT_KINDS: dict[str, Label] = {
    "distance_2d": KINDS["distance_2d"],
    "distance_3d": KINDS["distance_3d"],
    "curve_2d": KINDS["curve_2d"],
    "curve_3d": KINDS["curve_3d"],
    "angle_2d_3point": KINDS["angle_2d_3point"],
    "angle_3d_3point": KINDS["angle_3d_3point"],
    "angle_2d_from_horizontal": KINDS["angle_2d_from_horizontal"],
    "angle_4point": {"ar": "زاوية بين خطين", "en": "Angle between two lines"},
}

SOURCE_LABELS: dict[str, Label] = {
    "window_median": {"ar": "مباشر", "en": "direct"},
    "knn_snapped_to_mask": {"ar": "مُقرَّب إلى الجمل", "en": "snapped to camel"},
    "knn_fill": {"ar": "مُكمَّل من الجوار", "en": "filled from neighbours"},
    "knn_no_depth_band": {
        "ar": "خارج تغطية العمق، مُقرَّب إلى الجمل",
        "en": "outside depth coverage, snapped to camel",
    },
    "knn_raw_boundary": {"ar": "من حافة القناع", "en": "from the mask boundary"},
    "direct_off_mask": {"ar": "أرض / خلفية (مباشر)", "en": "ground / background (direct)"},
}
PLANE_LABELS: dict[str, Label] = {
    "zref_plane": {"ar": "مستوى Z_ref", "en": "Z_ref plane"},
    "image_plane": {"ar": "مستوى الصورة", "en": "image plane"},
    "from_lines": {"ar": "من الخطين", "en": "from the two lines"},
}

FLAG_LABELS: dict[str, dict[str, str]] = {
    "knn_far": {
        "ar": "الجيران بعيدون (> 10 سم)",
        "en": "neighbours far (> 10 cm)",
        "severity": "warn",
    },
    "knn_spread": {
        "ar": "تباين أعماق الجيران",
        "en": "neighbour depths spread",
        "severity": "warn",
    },
    "depth_edge": {
        "ar": "حافة عمق في النافذة",
        "en": "depth edge in the window",
        "severity": "warn",
    },
    "depth_edge_near_cluster": {
        "ar": "استُخدمت الطبقة الأقرب",
        "en": "nearer depth layer used",
        "severity": "info",
    },
    "off_mask_surface": {
        "ar": "سطح آخر تحت النقطة",
        "en": "another surface under the click",
        "severity": "warn",
    },
    "knn_disagree": {"ar": "يختلف عن الجيران", "en": "differs from neighbours", "severity": "info"},
    "window_unmasked": {
        "ar": "نافذة غير مقيدة بالقناع",
        "en": "window not limited to the mask",
        "severity": "info",
    },
    "knn_raw_boundary": {
        "ar": "استُخدمت حافة القناع",
        "en": "mask boundary used",
        "severity": "warn",
    },
    "ground_target_unresolved": {
        "ar": "لا عمق للأرض؛ قُرِّبت إلى الجمل",
        "en": "no ground depth; snapped to camel",
        "severity": "warn",
    },
    "outside_depth_fov": {
        "ar": "خارج تغطية العمق",
        "en": "outside depth coverage",
        "severity": "info",
    },
    "segment_depth_jump": {
        "ar": "قفزة عمق في مقطع",
        "en": "depth jump in a segment",
        "severity": "warn",
    },
    "endpoint_dz": {
        "ar": "نقطة بعيدة عن مستوى Z_ref (> 10 %)",
        "en": "point off the Z_ref plane (> 10 %)",
        "severity": "warn",
    },
}
ROW_FLAGS: tuple[str, ...] = ("segment_depth_jump", "endpoint_dz")

REJECTION_LABELS: dict[str, Label] = {
    "pixel_out_of_image": {"ar": "النقطة خارج الصورة", "en": "point outside the image"},
    "no_valid_depth_in_mask": {
        "ar": "لا يوجد عمق صالح في القناع",
        "en": "no valid depth in the mask",
    },
    "mask_valid_too_sparse": {
        "ar": "العمق الصالح في القناع قليل جدًا",
        "en": "too little valid depth in the mask",
    },
    "knn_too_far": {
        "ar": "أقرب نقاط الجمل بعيدة جدًا (> 30 سم)",
        "en": "nearest camel pixels too far (> 30 cm)",
    },
    "too_few_points": {"ar": "عدد النقاط غير كافٍ", "en": "too few points"},
    "line_not_found": {"ar": "الخط المرجعي غير موجود", "en": "referenced line not found"},
    "referenced_line_invalid": {"ar": "الخط المرجعي مرفوض", "en": "referenced line is rejected"},
    "mixed_line_kinds": {
        "ar": "خط ثنائي الأبعاد مع خط ثلاثي الأبعاد",
        "en": "one 2D and one 3D line",
    },
    "degenerate_lines": {"ar": "خط بطول صفر", "en": "zero-length line"},
    "degenerate_ray": {"ar": "ضلع بطول صفر", "en": "zero-length ray"},
    "zero_length": {"ar": "خط بطول صفر", "en": "zero-length line"},
}
ROW_REJECTIONS: tuple[str, ...] = tuple(REJECTION_LABELS)

CANDIDATE_REJECTION_LABELS: dict[str, Label] = {
    "no_detection": {"ar": "لم يُكتشف جمل", "en": "no camel detected"},
    "mask_area_out_of_range": {"ar": "مساحة القناع خارج النطاق", "en": "mask area out of range"},
    "mask_cut_by_frame": {
        "ar": "الجمل مقطوع عند حافة الصورة",
        "en": "camel cut off by the image edge",
    },
    "mask_incomplete": {
        "ar": "الجمل يدخل الهامش الخالي من العمق (وضع صارم)",
        "en": "camel reaches the depth-less margin (strict mode)",
    },
    "z_mean_below_floor": {"ar": "متوسط العمق أقل من 1 م", "en": "mean depth below 1 m"},
    "z_median_below_min": {"ar": "وسيط العمق أقل من الحد", "en": "median depth below the minimum"},
    "valid_frac_too_low": {"ar": "العمق الصالح قليل", "en": "too little valid depth"},
    "no_valid_depth_in_mask": REJECTION_LABELS["no_valid_depth_in_mask"],
}
CANDIDATE_FLAG_LABELS: dict[str, Label] = {
    "mask_in_depth_margin": {
        "ar": "جزء من الجمل خارج مجال العمق (العمق هناك من أقرب نقاط الجمل)",
        "en": "part of the camel is outside the depth field (KNN depth there)",
        "severity": "info",
    },
}

STATUS_LABELS: dict[str, Label] = {
    "open": {"ar": "مفتوحة", "en": "open"},
    "finalized": {"ar": "مُعتمدة", "en": "finalized"},
    "exported": {"ar": "مُصدَّرة", "en": "exported"},
}
BUCKET_LABELS: dict[str, Label] = {
    "SIDE": {"ar": "جانبي", "en": "side"},
    "END": {"ar": "أمامي / خلفي", "en": "end-on"},
    "QUARTER": {"ar": "مائل", "en": "quarter"},
}
TARGET_LABELS: dict[str, Label] = {
    "camel": {"ar": "الجمل", "en": "camel"},
    "ground": {"ar": "أرض / خلفية", "en": "ground / background"},
}
GROUND_BADGE_LABELS: dict[str, Label] = {
    "far_side_row_differs": {
        "ar": "خط الأرض من الساق القريبة",
        "en": "ground line from the near legs",
    },
    "ground_row_unresolved": {"ar": "خط الأرض غير محسوم", "en": "ground line unresolved"},
}
CONFIDENCE_LABELS: dict[str, Label] = {
    "high": {"ar": "عالية", "en": "high"},
    "low": {"ar": "منخفضة", "en": "low"},
}
JOB_STATE_LABELS: dict[str, Label] = {
    "queued": {"ar": "في الانتظار", "en": "queued"},
    "running": {"ar": "قيد التشغيل", "en": "running"},
    "cancelling": {"ar": "جارٍ الإلغاء", "en": "cancelling"},
    "done": {"ar": "اكتمل", "en": "done"},
    "cancelled": {"ar": "أُلغي", "en": "cancelled"},
    "failed": {"ar": "فشل", "en": "failed"},
}


def fmt_len(value: float | None, lang: str) -> str:
    """Length with smart units: < 0.10 m in cm (1 decimal), else m (3 decimals)."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"
    v = float(value)
    if v < 0.10:
        return f"{v * 100.0:.1f} {'سم' if lang == 'ar' else 'cm'}"
    return f"{v:.3f} {'م' if lang == 'ar' else 'm'}"


def fmt_angle(value: float | None) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"
    return f"{float(value):+.1f}°"


def label(table: dict[str, Any], code: str) -> Label:
    entry = table.get(code)
    if entry is None:
        return {"ar": code, "en": code}
    return {"ar": entry["ar"], "en": entry["en"]}


def flag_chip(code: str) -> dict[str, str]:
    entry = FLAG_LABELS.get(code, {"ar": code, "en": code, "severity": "info"})
    return {"code": code, "ar": entry["ar"], "en": entry["en"], "severity": entry["severity"]}


def rejection_parts(reason: str) -> list[dict[str, Any]]:
    """Split ``"p1:knn_too_far / p2:pixel_out_of_image"`` into labelled parts."""
    parts: list[dict[str, Any]] = []
    for chunk in [c.strip() for c in (reason or "").split(" / ") if c.strip()]:
        point: str | None = None
        code = chunk
        if ":" in chunk:
            point, code = (s.strip() for s in chunk.split(":", 1))
        entry = label(REJECTION_LABELS, code)
        parts.append({"point": point, "code": code, "ar": entry["ar"], "en": entry["en"]})
    return parts


def depth_basis(provenance: dict[str, Any] | None, *, kind: str, z_ref_m: float | None) -> Label:
    """The bilingual "Depth basis" cell for one point (C1.6)."""
    if kind in ("distance_2d", "curve_2d"):
        z = "--" if z_ref_m is None else f"{float(z_ref_m):.3f}"
        return {"ar": f"مستوى Z_ref {z} م", "en": f"Z_ref {z} m"}
    if kind in ("angle_2d_3point", "angle_2d_from_horizontal", "angle_2d_4point"):
        return dict(PLANE_LABELS["image_plane"])
    if kind == "angle_3d_4point":
        return dict(PLANE_LABELS["from_lines"])
    if provenance is None:
        return {"ar": "--", "en": "--"}
    reason = provenance.get("reason") or ""
    if reason:
        entry = label(REJECTION_LABELS, reason)
        return {"ar": f"مرفوض: {entry['ar']}", "en": f"rejected: {entry['en']}"}
    source = provenance.get("source") or ""
    depth = provenance.get("depth_m")
    if source == "window_median":
        return {"ar": f"مباشر {fmt_len(depth, 'ar')}", "en": f"direct {fmt_len(depth, 'en')}"}
    if source == "direct_off_mask":
        return {
            "ar": f"أرض (مباشر) {fmt_len(depth, 'ar')}",
            "en": f"ground (direct) {fmt_len(depth, 'en')}",
        }
    if source.startswith("knn_"):
        snap = provenance.get("nn_dist_m_max")
        base = label(SOURCE_LABELS, source)
        cell = {
            "ar": f"{base['ar']} {fmt_len(snap, 'ar')}",
            "en": f"{base['en']} {fmt_len(snap, 'en')}",
        }
        direct = provenance.get("direct_depth_m")
        if "off_mask_surface" in (provenance.get("flags") or []) and direct is not None:
            # C1.4: the click sat on another surface; print both depths
            cell["ar"] += f" · الجمل {fmt_len(depth, 'ar')} / السطح {fmt_len(direct, 'ar')}"
            cell["en"] += f" · camel {fmt_len(depth, 'en')} / surface {fmt_len(direct, 'en')}"
        return cell
    return {"ar": "--", "en": "--"}


def _point_provenances(row: dict[str, Any]) -> list[dict[str, Any] | None]:
    family = row.get("family")
    if family == "lines":
        return [row.get("p1_depth"), row.get("p2_depth")]
    if family == "curves":
        return list(row.get("point_depth") or [])
    kind = row.get("kind") or row.get("measurement_type")
    if kind in ("angle_2d_3point", "angle_3d_3point"):
        return [row.get("vertex_depth"), row.get("endpoint_a_depth"), row.get("endpoint_b_depth")]
    if kind == "angle_2d_from_horizontal":
        return [row.get("endpoint_a_depth"), row.get("endpoint_b_depth")]
    return []


def describe_row(row: dict[str, Any], *, z_ref_m: float | None) -> dict[str, Any]:
    """Presentation fields shared by the canvas list, the overlay labels and the PDF."""
    kind = row.get("kind") or row.get("measurement_type") or ""
    family = row.get("family") or ""
    if family == "angles":
        value = row.get("angle_deg")
        unit = "deg"
        value_text = {"ar": fmt_angle(value), "en": fmt_angle(value)}
    else:
        value = row.get("distance_m") if family == "lines" else row.get("total_length_m")
        unit = "m"
        value_text = {"ar": fmt_len(value, "ar"), "en": fmt_len(value, "en")}
    unc = row.get("uncertainty_m")
    unc_text = (
        {"ar": f"± {fmt_len(unc, 'ar')}", "en": f"± {fmt_len(unc, 'en')}"}
        if unc is not None and value is not None
        else {"ar": "", "en": ""}
    )
    provs = _point_provenances(row)
    basis = [
        {"point": i + 1, **depth_basis(p, kind=kind, z_ref_m=z_ref_m)} for i, p in enumerate(provs)
    ]
    if not basis and kind == "angle_3d_4point":
        basis = [{"point": None, **PLANE_LABELS["from_lines"]}]
    codes: list[str] = []
    for code in row.get("flags") or []:
        if code not in codes:
            codes.append(code)
    for p in provs:
        for code in (p or {}).get("flags") or []:
            if code not in codes:
                codes.append(code)
    confidence = row.get("confidence")
    reason = row.get("rejection_reason") or ""
    n_points = len(provs)
    n_knn = sum(1 for p in provs if p and str(p.get("source") or "").startswith("knn_"))
    return {
        "kind_label": label(KINDS, kind),
        "value": value,
        "unit": unit,
        "value_text": value_text,
        "uncertainty_text": unc_text,
        "depth_basis": basis,
        "flags": [flag_chip(c) for c in codes],
        "confidence": (
            {"code": confidence, **label(CONFIDENCE_LABELS, confidence)} if confidence else None
        ),
        "rejected": bool(reason),
        "rejection": rejection_parts(reason),
        "n_points": n_points,
        "n_points_knn": n_knn if kind not in ("distance_2d", "curve_2d") else 0,
    }


def snapped_summary(n_knn: int, n_points: int) -> Label:
    return {
        "ar": f"{n_knn} من {n_points} نقطة قُرِّبت إلى الجمل (KNN)",
        "en": f"{n_knn} of {n_points} points snapped to the camel (KNN)",
    }


def labels_payload() -> dict[str, Any]:
    """Everything the UI needs to render codes without hard-coding strings (B16)."""
    return {
        "kinds": KINDS,
        "input_kinds": INPUT_KINDS,
        "sources": SOURCE_LABELS,
        "planes": PLANE_LABELS,
        "flags": FLAG_LABELS,
        "rejections": REJECTION_LABELS,
        "candidate_rejections": CANDIDATE_REJECTION_LABELS,
        "candidate_flags": CANDIDATE_FLAG_LABELS,
        "statuses": STATUS_LABELS,
        "buckets": BUCKET_LABELS,
        "targets": TARGET_LABELS,
        "ground_badges": GROUND_BADGE_LABELS,
        "confidence": CONFIDENCE_LABELS,
        "job_states": JOB_STATE_LABELS,
        "constants": {
            "KNN_K": KNN_K,
            "KNN_RING_EXCLUDE_PX": KNN_RING_EXCLUDE_PX,
            "KNN_FAR_M": KNN_FAR_M,
            "KNN_MAX_DIST_M": KNN_MAX_DIST_M,
            "ENDPOINT_DZ_FLAG_FRAC": ENDPOINT_DZ_FLAG_FRAC,
            "Z_MEAN_MIN_M": Z_MEAN_MIN_M,
        },
    }


def coverage_problems() -> list[str]:
    """Codes the engine can emit that have no bilingual label (must stay empty)."""
    missing: list[str] = []
    for code in SOURCES:
        if code not in SOURCE_LABELS:
            missing.append(f"source:{code}")
    for code in (*SOFT_FLAGS, *ROW_FLAGS):
        if code not in FLAG_LABELS:
            missing.append(f"flag:{code}")
    for code in HARD_REJECTIONS:
        if code not in REJECTION_LABELS:
            missing.append(f"rejection:{code}")
    from .candidates import CANDIDATE_FLAGS, REJECTION_REASONS

    for code in REJECTION_REASONS:
        if code not in CANDIDATE_REJECTION_LABELS:
            missing.append(f"candidate_rejection:{code}")
    for code in CANDIDATE_FLAGS:
        if code not in CANDIDATE_FLAG_LABELS:
            missing.append(f"candidate_flag:{code}")
    for table in (
        KINDS,
        INPUT_KINDS,
        SOURCE_LABELS,
        FLAG_LABELS,
        REJECTION_LABELS,
        CANDIDATE_REJECTION_LABELS,
        CANDIDATE_FLAG_LABELS,
        STATUS_LABELS,
        BUCKET_LABELS,
        TARGET_LABELS,
        GROUND_BADGE_LABELS,
        CONFIDENCE_LABELS,
        JOB_STATE_LABELS,
    ):
        for code, entry in table.items():
            if not entry.get("ar") or not entry.get("en"):
                missing.append(f"empty:{code}")
    return missing
