"""Every contract constant of the engine, in one place.

Each constant cites the rule it implements (``nazeer-desktop/CLAUDE.md``: the inference
contract, contracts C1-C3, ADR-D7) so a reviewer can audit the number against the rule.
``CONSTANTS_STAMP`` is written into every ``session.json``, ``candidates.json`` and report
manifest so a stored number can always be traced to the thresholds that produced it.
"""

from __future__ import annotations

ENGINE_VERSION = "0.1.0"
SESSION_SCHEMA_VERSION = "2.1"  # C3.6
REPORT_MODEL_VERSION = "1.0"
MANIFEST_VERSION = "1.0"
CANDIDATES_VERSION = "1.0"
HISTORY_INDEX_VERSION = 1

# --- model card §3 (inference contract) -------------------------------------------------
MODEL_FILE_DEFAULT = "best.pt"
MODEL_SHA256_PINNED = "0e9ee2baada7c70531b66e0b98f7e1cf4dcf3ce7971c55bce69a7270ec3a4320"
FONT_FILE = "IBMPlexSansArabic-Regular.ttf"
FONT_SHA256_PINNED = "8e0f1046c736bf939d4939ee3ae0116acf61cbcd6592deae7656761627080981"
YOLO_CONF = 0.5
YOLO_IMGSZ = 640
YOLO_IOU = 0.7  # ultralytics default, made explicit
YOLO_MAX_DET = 300  # ultralytics default, made explicit
YOLO_MASK_THRESHOLD = 0.5
WARMUP_FRAME_SHAPE = (720, 1280)

# --- C1 depth lookup ----------------------------------------------------------------------
DEPTH_MIN_M = 0.3  # C1.1
DEPTH_MAX_M = 5.0  # C1.1
DEPTH_WINDOW = 5  # C1.2
WINDOW_MIN_VALID_FRAC = 0.30  # C1.2 (of the nominal 25 pixels, as the parent rule)
WINDOW_MIN_IN_MASK_FRAC = 0.30  # C1.2 restrict to in-mask pixels when >= 30 % are in-mask
EDGE_SPREAD_ABS_M = 0.10  # C1.2 depth_edge = spread > max(0.10 m, 5 % of Z)
EDGE_SPREAD_FRAC = 0.05
# C1.2 / C1.3 "nearer / nearest cluster": a cluster needs max(3 px, 20 %) of the values, so
# one stray pixel never replaces the median of 24 agreeing ones (review 2026-10-11)
EDGE_CLUSTER_MIN_PX = 3
EDGE_CLUSTER_MIN_FRAC = 0.20
KNN_K = 9  # C1.3
KNN_RING_EXCLUDE_PX = 2  # C1.3 erosion of the mask before building the tree
KNN_AGGREGATE = "median"  # C1.3 (operator said "average"; D8 evidence chose the median)
AGREE_ABS_M = 0.05  # C1.4 direct-vs-KNN agreement = max(0.05 m, 3 % of Z)
AGREE_FRAC = 0.03
KNN_FAR_M = 0.10  # C1.5 soft flag knn_far
KNN_MAX_DIST_M = 0.30  # C1.5 hard rejection knn_too_far
MASK_SPARSE_MIN_FRAC = 0.02  # C1.5 mask_valid_too_sparse = eroded valid < max(KNN_K, 2 %)
SEGMENT_JUMP_ABS_M = 0.15  # C1.7 segment_depth_jump = |dz| > max(0.15 m, half the segment)
SEGMENT_JUMP_FRAC = 0.5
ENDPOINT_DZ_FLAG_FRAC = 0.10  # C1.8
SIGMA_D_FRAC = 0.01  # D455 depth noise rule of thumb (parent SIGMA_D_FRAC)
PIXEL_ROUNDING = "half_up"  # B32: matches JavaScript Math.round, not banker's rounding
UNCERTAINTY_BASIS = "sigma_d_1pct+knn_snap"

# --- ground line (inference contract) ------------------------------------------------------
GROUND_BAND_PX = 8
GROUND_TOL_FRAC = 0.12
GROUND_BADGE_PX = 8

# --- depth FOV (inference contract, B4) ----------------------------------------------------
DEPTH_VALID_MIN_FRAC = 0.05

# --- C2 frame candidates -------------------------------------------------------------------
SAMPLE_EVERY_DEFAULT = 5  # C2.1
SAMPLE_TARGET_FRAMES = 400  # C2.1 auto-raise: max(5, n_frames // 400)
MAF_LOW = 0.10  # C2.4 mask area fraction bounds
MAF_HIGH = 0.80
Z_MEAN_MIN_M = 1.0  # C2.4 the operator's absolute floor (never lowered)
Z_MEDIAN_MIN_M_DEFAULT = 1.5  # C2.4 proposed gate (A8), tunable
VALID_FRAC_MIN = 0.6  # C2.4
# C2.4 completeness, revised 2026-10-11 on real bags (D10 engine parameters): the hard gate is
# the parent's "mask touches the image border"; intruding into the depth-less colour margin
# (8 px of the depth-valid region) is a visible soft flag, and the hard gate only when
# ``strict_depth_fov`` is set. The literal rule rejected all 155 sampled frames of bag 004 and
# the golden frame itself (its head sits in the 22 depth-less top rows).
FRAME_MARGIN_PX = 1  # mask pixels must keep >= this many px from the image border (0 = off)
COMPLETENESS_MARGIN_PX = 8  # depth-valid margin: soft flag, or the gate with strict_depth_fov
STRICT_DEPTH_FOV_DEFAULT = False
ASPECT_SIDE_MIN = 1.6  # C2.5
ASPECT_END_MAX = 1.3  # C2.5
CANDIDATES_M = 12  # C2.7
CANDIDATES_M_MAX = 48
MINORITY_RESERVE = 2  # C2.5
NOISE_FLOOR_FRAC = 0.15  # C2.5 z_var differences below this are frame-to-frame noise
BIN_SEC = 1.5  # C2.5 / C2.6
HOLDER_CAP = 48  # C2.6
FPS_NOMINAL = 30
CACHE_MAX_BYTES = 2 * 1024**3  # C2.7 LRU purge threshold
SLOW_MEDIA_PROBE_BYTES = 200 * 1024**2  # C2.8
SLOW_MEDIA_MB_S = 300.0
SLOW_MEDIA_MIN_SAMPLE_BYTES = 32 * 1024**2  # below this the probe is not a measurement
BAG_FRAME_TIMEOUT_MS = 2000  # B14
BAG_EOF_MIN_POSITION_FRAC = 0.99  # B14
BAG_STALL_RETRIES = 3  # B14
THUMB_SIZE = (320, 180)  # C2.7 (width, height)
THUMB_JPEG_QUALITY = 85
JOB_HISTORY_KEEP = 20

# --- C3 session / history / export ---------------------------------------------------------
AUTOSAVE_RETRY_DELAYS_S = (0.05, 0.15, 0.45)  # C3.4
TEMP_PURGE_AGE_S = 3600  # C3.4
PDF_MAX_BYTES = 64 * 1024**2
PDF_PIXEL_MAX_ABS_DIFF = 0  # D7 pixel probe (measured 0 against real Chromium output)
BACKUP_INTERVAL_S = 86400
BACKUP_KEEP = 5
RECENT_BAGS_KEEP = 20
FRAME_CONTEXT_CACHE = 4  # B5

# --- overlay (ADR-D7, B12) -----------------------------------------------------------------
OVERLAY_DPI = 100
OVERLAY_FOOTER_PX = 120

# --- API ---------------------------------------------------------------------------------------
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "app://nazeer")
THREADPOOL_TOKENS = 8
# ids and revisions travel through JavaScript numbers and SQLite INTEGER: cap at 2**53 - 1
MAX_SAFE_INT = 2**53 - 1


def constants_stamp() -> dict[str, object]:
    """Every upper-case constant of this module as a plain dict (tuples become lists)."""
    out: dict[str, object] = {}
    for name, value in sorted(globals().items()):
        if name.isupper() and not name.startswith("_"):
            out[name] = list(value) if isinstance(value, tuple) else value
    return out


CONSTANTS_STAMP = constants_stamp()
