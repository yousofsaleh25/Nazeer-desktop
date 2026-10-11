from __future__ import annotations

from nazeer_engine import constants
from nazeer_engine.jsonsafe import dumps


def test_stamp_contains_every_constant_and_is_json_safe():
    stamp = constants.CONSTANTS_STAMP
    for name in ("KNN_K", "DEPTH_WINDOW", "Z_MEAN_MIN_M", "MODEL_SHA256_PINNED", "THUMB_SIZE"):
        assert name in stamp
    assert stamp["THUMB_SIZE"] == [320, 180]
    assert "constants_stamp" not in stamp
    dumps(stamp)


def test_operator_rules_are_pinned():
    assert constants.KNN_K == 9 and constants.KNN_K % 2 == 1
    assert constants.KNN_RING_EXCLUDE_PX == 2
    assert constants.KNN_AGGREGATE == "median"
    assert constants.Z_MEAN_MIN_M == 1.0
    assert constants.DEPTH_MIN_M == 0.3 and constants.DEPTH_MAX_M == 5.0
    assert constants.YOLO_CONF == 0.5 and constants.YOLO_IMGSZ == 640
    assert constants.SESSION_SCHEMA_VERSION == "2.1"
    assert constants.KNN_MAX_DIST_M > constants.KNN_FAR_M
    assert constants.MAF_LOW < constants.MAF_HIGH
    assert constants.ASPECT_END_MAX < constants.ASPECT_SIDE_MIN
    assert constants.PDF_PIXEL_MAX_ABS_DIFF == 0
