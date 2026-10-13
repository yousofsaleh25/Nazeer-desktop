"""Static report content, vendored as data from the parent's Phase-16 judge form
(``desktop/pages/p4_report.py`` constants and ``notebook_report_template.html`` headings).

The engine never scores beauty: the rubric is carried as an empty form (weights and
labels only) for the judge to fill in by hand on the printed PDF.
"""

from __future__ import annotations

from typing import Any

Label = dict[str, str]

BRAND: Label = {"ar": "نظير", "en": "Nazeer"}
TITLE: Label = {"ar": "تقرير قياس جمال الإبل", "en": "Camel Beauty Measurement Report"}
CERTIFICATION: dict[str, list[str]] = {
    "ar": ["معتمدة من شركة نظير", "الموسوعة الرقمية للجمال العربية"],
    "en": ["Certified by Nazeer Company", "Digital Encyclopedia of Arabian Beauty"],
}
DISCLAIMER: Label = {
    "ar": "يقيس نظير ما يرسمه الحكم على الصورة ولا يقيّم الجمال.",
    "en": "Nazeer measures what the judge draws on the frame; it does not score beauty.",
}

# (ar, en, weight %) — Mzayen rubric, parent docs/references/كتاب_الإبل_2.md §1.1 / §1.2
RUBRIC_MJAHEEM: list[tuple[str, str, int]] = [
    ("الرأس", "Head", 25),
    ("الرقبة", "Neck", 15),
    ("الغارب", "Withers", 10),
    ("الرق والتناسق والتوازن", "Slimness, Harmony, Balance", 10),
    ("الإرتفاع", "Height / Stature", 10),
    ("الجنب", "Flank", 5),
    ("النحر + الشخر", "Chest + Bridle", 5),
    ("الجبار + الخف", "Bone Structure + Hoof", 5),
    ("العرقوب + اليد", "Hock + Foreleg", 5),
    ("اللون + الوبرة + الذيل", "Color + Coat + Tail", 5),
    ("السنام + الفقار + العيز", "Hump + Vertebrae + Tail-base", 5),
]
RUBRIC_MAGHATEER: list[tuple[str, str, int]] = [
    ("الرأس", "Head", 25),
    ("الرقبة", "Neck", 15),
    ("الغارب", "Withers", 10),
    ("السنام + الفقار + العيز", "Hump + Vertebrae + Tail-base", 10),
    ("الرق والتناسق والتوازن", "Slimness, Harmony, Balance", 10),
    ("الإرتفاع", "Height / Stature", 5),
    ("الجنب", "Flank", 5),
    ("النحر + الشخر", "Chest + Bridle", 5),
    ("الجبار + الخف", "Bone Structure + Hoof", 5),
    ("العرقوب + اليد", "Hock + Foreleg", 5),
    ("اللون + الوبرة + الذيل", "Color + Coat + Tail", 5),
]
RUBRIC_VARIANTS: dict[str, Label] = {
    "mjaheem": {"ar": "المجاهيم", "en": "Mjaheem"},
    "maghateer": {"ar": "المغاتير", "en": "Maghateer"},
}

# (number, Arabic name, English, body part in Arabic) — the book's 27-region diagram
ANATOMICAL_REGIONS_27: list[tuple[int, str, str, str]] = [
    (1, "السبال (الشوارب)", "Mustache (whiskers)", "الرأس / الفم"),
    (2, "فتحات الأنف", "Nostrils", "الرأس / الأنف"),
    (3, "الخشم", "Muzzle / snout", "الرأس / الأنف"),
    (4, "العين", "Eye", "الرأس"),
    (5, "الأذن", "Ear", "الرأس"),
    (6, "المعذر", "Cheek / jaw", "الرأس"),
    (7, "المصنة", "Brow ridge area", "الرأس"),
    (8, "الكتف", "Shoulder", "الجذع الأمامي"),
    (9, "الغارب", "Withers", "الظهر الأمامي"),
    (10, "السنام", "Hump", "الظهر"),
    (11, "العيز", "Lower-back / coccyx", "الظهر الخلفي"),
    (12, "الفقار", "Vertebrae", "الظهر"),
    (13, "الذيل", "Tail", "المؤخرة"),
    (14, "الفخذ", "Thigh", "الرجل الخلفية"),
    (15, "العرقوب", "Hock", "الرجل الخلفية"),
    (16, "الساق", "Lower leg", "الرجل الخلفية"),
    (17, "الثفنة", "Callus / footpad", "الأخفاف"),
    (18, "البركة", "Knee callus (chest)", "الصدر السفلي"),
    (19, "الكرسوع", "Wrist (carpal joint)", "اليد الأمامية"),
    (20, "الخف", "Hoof / foot", "الأخفاف"),
    (21, "الركبة", "Knee", "اليد الأمامية"),
    (22, "ساق اليد", "Foreleg shaft", "اليد الأمامية"),
    (23, "النحر", "Chest / breastbone", "الصدر"),
    (24, "الرقبة", "Neck", "الرقبة"),
    (25, "هامة الرأس", "Crown of head", "الرأس"),
    (26, "الخد", "Cheek", "الرأس"),
    (27, "الشخر", "Bridle area", "الصدر / الرقبة"),
]

MAGHATEER_COLORS: list[tuple[str, str]] = [
    ("وضح", "Wadah (pure white)"),
    ("شقح", "Shaqah (off-white/reddish)"),
    ("حمر", "Hamr (red)"),
    ("شعل", "Sha'l (white with dark spots)"),
    ("صفر", "Safar (yellowish)"),
]
COLOUR_OPTIONS: list[tuple[str, str]] = [("مجاهيم", "Mjaheem (black)"), *MAGHATEER_COLORS]

OBSERVATION_FIELDS: list[dict[str, str]] = [
    {"key": "colour", "ar": "اللون", "en": "Color", "kind": "select", "placeholder": ""},
    {
        "key": "age",
        "ar": "الفئة العمرية",
        "en": "Age Class",
        "kind": "text",
        "placeholder": "نعش، حق، لقي، ثني، رباع، سداس / from teeth",
    },
    {
        "key": "coat",
        "ar": "الوبر",
        "en": "Coat Quality",
        "kind": "text",
        "placeholder": "كثيف / متوسط / خفيف",
    },
    {
        "key": "gait",
        "ar": "حركة المشي",
        "en": "Gait",
        "kind": "text",
        "placeholder": "فجحاء / أعقل / زوحاء / ركزاء",
    },
    {
        "key": "defects",
        "ar": "العيوب",
        "en": "Defects observed",
        "kind": "textarea",
        "placeholder": "",
    },
    {
        "key": "manual",
        "ar": "قياسات يدوية",
        "en": "Manual measurements",
        "kind": "textarea",
        "placeholder": "محيط الصدر: ___ cm، عرض الخف: ___ cm، طول الذيل: ___ cm",
    },
]
OBSERVATION_KEYS: tuple[str, ...] = tuple(f["key"] for f in OBSERVATION_FIELDS)

HEADINGS: dict[str, Label] = {
    "session": {"ar": "معلومات الجلسة", "en": "Session Information"},
    "measurements": {"ar": "القياسات الآلية (الكاميرا)", "en": "Camera-Derived Measurements"},
    "camel_view": {"ar": "المنظر الجانبي مع القياسات", "en": "Side View with Measurements"},
    "scoring_form": {
        "ar": "استمارة تحكيم المجاهيم — للمنافسات",
        "en": "Mzayen Scoring Form — for Competitions",
    },
    "form_variant": {"ar": "نوع الاستمارة:", "en": "Form variant:"},
    "regions": {"ar": "المناطق التشريحية الـ27 — مرجع", "en": "27 Anatomical Regions — Reference"},
    "observations": {"ar": "ملاحظات إضافية للحكم", "en": "Judge's External Observations"},
    "signatures": {"ar": "التوقيعات", "en": "Signatures"},
    "frame": {"ar": "الإطار المختار", "en": "Selected frame"},
    "depth": {"ar": "العمق المرجعي وخط الأرض", "en": "Reference depth and ground line"},
    "provenance": {"ar": "مصدر البيانات والإصدارات", "en": "Provenance and versions"},
}
COLUMNS: dict[str, Label] = {
    "color": {"ar": "اللون", "en": "Color"},
    "measurement": {"ar": "القياس", "en": "Measurement"},
    "kind": {"ar": "النوع", "en": "Type"},
    "value": {"ar": "القيمة", "en": "Value"},
    "uncertainty": {"ar": "الدقة", "en": "Uncertainty"},
    "depth_basis": {"ar": "أساس العمق", "en": "Depth basis"},
    "flags": {"ar": "تنبيهات", "en": "Flags"},
    "region": {"ar": "العضو", "en": "Region"},
    "weight": {"ar": "الوزن", "en": "Weight"},
    "judge_score": {"ar": "درجة الحكم", "en": "Judge Score"},
    "notes": {"ar": "ملاحظات", "en": "Notes"},
    "total": {"ar": "المجموع", "en": "Total"},
    "arabic_name": {"ar": "الاسم العربي", "en": "Arabic name"},
    "english": {"ar": "الترجمة", "en": "English"},
    "body_part": {"ar": "المنطقة الجسمية", "en": "Body part"},
}
SESSION_ROWS: dict[str, Label] = {
    "session_id": {"ar": "المعرّف", "en": "Session ID"},
    "operator": {"ar": "المشغّل", "en": "Operator"},
    "camel_id": {"ar": "معرّف الجمل", "en": "Camel ID"},
    "event": {"ar": "الفعالية", "en": "Event"},
    "n_measurements": {"ar": "عدد القياسات", "en": "Measurements"},
    "source_frame": {"ar": "المصدر", "en": "Source frame"},
    "generated": {"ar": "تاريخ التوليد", "en": "Generated"},
}
SIGNATURE_WELLS: list[dict[str, str]] = [
    {"id": "judge", "ar": "توقيع الحكم", "en": "Judge Signature"},
    {"id": "council", "ar": "توقيع مجلس الحكام", "en": "Council of Judges Signature"},
]
SIGNATURE_FIELDS: dict[str, Label] = {
    "name": {"ar": "الاسم", "en": "Name"},
    "date": {"ar": "التاريخ", "en": "Date"},
}
# report model 1.1: the print page's remaining labels (the values are in report_model.py)
REJECTED: Label = {"ar": "مرفوض", "en": "Rejected"}
FRAME_ROWS: dict[str, Label] = {
    "z_ref": {"ar": "العمق المرجعي", "en": "Reference depth Z_ref"},
    "ground": {"ar": "خط الأرض", "en": "Ground line"},
    "depth_bbox": {"ar": "منطقة العمق الصالح", "en": "Depth-valid region"},
    "model": {"ar": "النموذج", "en": "Model"},
    "intrinsics": {"ar": "معاملات الكاميرا", "en": "Camera intrinsics"},
    "candidate": {"ar": "الإطار المقترح", "en": "Proposed frame"},
}
PROVENANCE_ROWS: dict[str, Label] = {
    "engine": {"ar": "المحرك", "en": "Engine"},
    "report_model": {"ar": "بيانات التقرير", "en": "Report model"},
    "overlay": {"ar": "صورة المحرك", "en": "Engine image"},
    "session": {"ar": "الجلسة", "en": "Session"},
    "libraries": {"ar": "المكتبات", "en": "Libraries"},
}


def rubric_rows(variant: str) -> list[dict[str, Any]]:
    table = RUBRIC_MAGHATEER if variant == "maghateer" else RUBRIC_MJAHEEM
    return [{"num": i, "ar": ar, "en": en, "weight": w} for i, (ar, en, w) in enumerate(table, 1)]


def static_content(rubric_variant: str) -> dict[str, Any]:
    """Everything the print page needs besides the measurements (B7)."""
    return {
        "brand": BRAND,
        "title": TITLE,
        "certification": CERTIFICATION,
        "disclaimer": DISCLAIMER,
        "headings": HEADINGS,
        "columns": COLUMNS,
        "session_rows": SESSION_ROWS,
        "rubric": {
            "variant": rubric_variant,
            "variant_label": RUBRIC_VARIANTS.get(rubric_variant, RUBRIC_VARIANTS["mjaheem"]),
            "variants": RUBRIC_VARIANTS,
            "rows": rubric_rows(rubric_variant),
            "mjaheem": rubric_rows("mjaheem"),
            "maghateer": rubric_rows("maghateer"),
            "total_weight": 100,
        },
        "regions_27": [
            {"num": n, "ar": ar, "en": en, "body_part_ar": body}
            for n, ar, en, body in ANATOMICAL_REGIONS_27
        ],
        "colour_options": [{"ar": ar, "en": en} for ar, en in COLOUR_OPTIONS],
        "observation_fields": OBSERVATION_FIELDS,
        "signature_fields": SIGNATURE_FIELDS,
        "rejected": REJECTED,
        "frame_rows": FRAME_ROWS,
        "provenance_rows": PROVENANCE_ROWS,
    }
