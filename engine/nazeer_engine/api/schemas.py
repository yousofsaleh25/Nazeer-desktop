"""Request / response models (pydantic v2) — the typed contract for the React + Redux client.

Request models forbid unknown fields and non-finite numbers (``allow_inf_nan=False``:
Starlette's JSON parser accepts bare ``NaN`` tokens, B29). Response models document the
shapes for OpenAPI / ``openapi-typescript``; handlers return ``FiniteJSONResponse``
directly, so runtime serialisation never depends on these classes (B31). Every enum is a
closed ``Literal`` so the generated TypeScript gets union types (B16).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..constants import MAX_SAFE_INT

InputKind = Literal[
    "distance_2d",
    "distance_3d",
    "curve_2d",
    "curve_3d",
    "angle_2d_3point",
    "angle_3d_3point",
    "angle_2d_from_horizontal",
    "angle_4point",
]
MeasurementKind = Literal[
    "distance_2d",
    "distance_3d",
    "curve_2d",
    "curve_3d",
    "angle_3d_4point",
    "angle_2d_4point",
    "angle_2d_3point",
    "angle_3d_3point",
    "angle_2d_from_horizontal",
]
Family = Literal["lines", "curves", "angles"]
Target = Literal["camel", "ground"]
Status = Literal["open", "finalized", "exported"]
Confidence = Literal["high", "low"]
JobStateName = Literal["queued", "running", "cancelling", "done", "cancelled", "failed"]
JobStage = Literal["queued", "opening", "walking", "ranking", "persisting", "done"]
Language = Literal["ar", "en", "both"]
RubricVariant = Literal["mjaheem", "maghateer"]
Bucket = Literal["SIDE", "END", "QUARTER"]
IndexState = Literal["ok", "missing_files", "corrupt", "delete_failed", "unindexed"]
DepthSource = Literal[
    "window_median",
    "knn_snapped_to_mask",
    "knn_fill",
    "knn_no_depth_band",
    "knn_raw_boundary",
    "direct_off_mask",
]
Point = tuple[float, float]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class _Out(BaseModel):
    model_config = ConfigDict(extra="allow")


class Bilingual(_Out):
    ar: str
    en: str


# ----- errors ------------------------------------------------------------------------------


class ErrorDetail(_Out):
    code: str = Field(description="Stable machine-readable code, e.g. stale_revision")
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorOut(BaseModel):
    error: ErrorDetail


# ----- system ------------------------------------------------------------------------------


class ModelInfo(_Out):
    file: str | None
    sha256: str | None
    stub: bool


class ArabicStack(_Out):
    ok: bool
    reason: str
    font_sha256: str | None
    font_pinned: bool = Field(
        description="the bundled TTF is the one the probes were measured with"
    )
    native_layout: bool | None


class JobCounters(_Out):
    read: int = 0
    sampled: int = 0
    detected: int = 0
    passed: int = 0
    rejected_by_reason: dict[str, int] = Field(
        default_factory=dict, description="live, by candidate_rejections code (/meta/labels)"
    )


class JobSnapshot(_Out):
    job_id: str
    bag_path: str
    fingerprint: str
    params_hash: str
    state: JobStateName
    stage: JobStage
    progress_fraction: float
    counters: JobCounters
    eta_s: float | None
    elapsed_s: float
    message: str
    warnings: list[str]
    error: ErrorDetail | None = Field(description="same shape as every API error body")
    result: dict[str, Any] | None
    started_at: str
    finished_at: str | None
    terminal: bool


class Health(_Out):
    status: Literal["ok"]
    engine_version: str
    pid: int
    run_id: str
    started_at: str
    uptime_s: float
    data_root: str
    model: ModelInfo
    warmup_ms: float | None
    arabic_stack: ArabicStack
    job: JobSnapshot | None


# ----- bags --------------------------------------------------------------------------------


class BagPathIn(_In):
    path: str = Field(min_length=1, max_length=4096)


class StreamInfo(_Out):
    width: int
    height: int
    fps: int
    format: str


class BagInfoOut(_Out):
    path: str
    name: str
    size_bytes: int
    mtime_ns: int
    fingerprint: str
    duration_s: float
    device_name: str
    color: StreamInfo
    depth: StreamInfo
    depth_units_m: float
    intrinsics: dict[str, Any]
    n_frames_estimate: int
    sample_every_effective: int
    path_fallback: str | None
    cached_candidate_sets: list[str] = Field(
        description="params_hash values with a ready candidate set for this bag"
    )


class RecentBag(_Out):
    path: str
    name: str
    last_opened_at: str
    exists: bool
    size_bytes: int | None
    fingerprint: str | None = None


class RecentBagList(_Out):
    items: list[RecentBag]
    total: int


# ----- candidates ----------------------------------------------------------------------------


class CandidateParamsIn(_In):
    sample_every: int | None = Field(default=None, ge=0, description="0 = automatic")
    m: int | None = Field(default=None, ge=1, le=48)
    z_mean_min_m: float | None = Field(default=None, ge=1.0, description="never below 1 m")
    z_median_min_m: float | None = Field(default=None, ge=0.0)
    maf_low: float | None = Field(default=None, ge=0.0, le=1.0)
    maf_high: float | None = Field(default=None, ge=0.0, le=1.0)
    valid_frac_min: float | None = Field(default=None, ge=0.0, le=1.0)
    frame_margin_px: int | None = Field(
        default=None, ge=0, description="px a mask keeps from the image border (0 = off)"
    )
    completeness_margin_px: int | None = Field(default=None, ge=0)
    strict_depth_fov: bool | None = Field(
        default=None,
        description="reject masks reaching the depth-less colour margin (else a soft flag)",
    )
    minority_reserve: int | None = Field(default=None, ge=0)


class JobStartIn(_In):
    bag_path: str = Field(min_length=1, max_length=4096)
    params: CandidateParamsIn | None = None
    force: bool = False


class CachedResult(_Out):
    fingerprint: str
    params_hash: str
    n_candidates: int | None = None
    partial: bool = Field(
        default=False, description="fewer than m frames passed (the walk itself was complete)"
    )


class JobStartOut(_Out):
    cached: bool
    job: JobSnapshot | None
    result: CachedResult | None
    candidates_url: str | None


class CandidateAssets(_Out):
    thumb: str
    rgb: str
    mask: str
    depth: str
    intrinsics: str
    stats: str


class CandidateItem(_Out):
    candidate_id: str
    rank: int
    bucket: Bucket | None
    read_index: int
    frame_number_color: int
    frame_number_depth: int
    bag_time_s: float
    conf: float | None
    mask_area_frac: float | None
    z_mean: float | None
    z_median: float | None
    z_var: float | None
    rel_disp: float | None
    valid_frac: float | None
    frame_clear: bool | None = None
    depth_fov_complete: bool | None = None
    flags: list[str] = Field(default_factory=list, description="soft, e.g. mask_in_depth_margin")
    urls: CandidateAssets
    ref: dict[str, str] = Field(description="the body of POST /sessions 'candidate'")


class CandidateSet(_Out):
    candidates_version: str
    fingerprint: str
    params_hash: str
    bag: dict[str, Any]
    params: dict[str, Any]
    model: dict[str, Any]
    sample_every_effective: int
    walk: dict[str, Any]
    rejected_by_reason: dict[str, int]
    selection: dict[str, Any]
    presentation: Literal["unordered"]
    candidates: list[CandidateItem]
    near_misses: list[dict[str, Any]]
    n_candidates: int
    partial: bool
    shortfall_reasons: list[str]
    warnings: list[str]
    frames: list[dict[str, Any]] | None = Field(
        default=None, description="every sampled frame's stats; only with include_frames=1"
    )


# ----- measurements and sessions -------------------------------------------------------------


class MeasurementInputModel(_In):
    """What the operator did — the only thing the client sends for a measurement."""

    id: int = Field(
        ge=1, le=MAX_SAFE_INT, description="stable, unique across all kinds; chosen by the client"
    )
    kind: InputKind
    name: str = Field(default="", max_length=200)
    points: list[Point] = Field(default_factory=list, max_length=500)
    targets: list[Target] | None = Field(
        default=None, description="per point; 'ground' = Shift-click ground/background point"
    )
    line_a_id: int | None = Field(default=None, ge=1, le=MAX_SAFE_INT)
    line_b_id: int | None = Field(default=None, ge=1, le=MAX_SAFE_INT)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    note: str = Field(default="", max_length=2000)


class DocumentBody(_In):
    camel_id: str | None = Field(
        default=None, max_length=64, description="omitted or null = keep the stored value"
    )
    operator: str | None = Field(
        default=None, max_length=100, description="omitted or null = keep the stored value"
    )
    notes: str | None = Field(
        default=None, max_length=4000, description="omitted or null = keep the stored value"
    )
    next_measurement_id: int | None = Field(default=None, ge=1, le=MAX_SAFE_INT)
    measurements: list[MeasurementInputModel] = Field(default_factory=list, max_length=500)


class DocumentIn(DocumentBody):
    revision: int = Field(
        ge=0,
        le=MAX_SAFE_INT,
        description="client-owned, strictly increasing; send stored revision + 1",
    )


class NamesIn(_In):
    judge: str | None = Field(default=None, max_length=100)
    council: str | None = Field(default=None, max_length=100)
    event: str | None = Field(default=None, max_length=100)


class ObservationsIn(_In):
    colour: str | None = Field(default=None, max_length=2000)
    age: str | None = Field(default=None, max_length=2000)
    coat: str | None = Field(default=None, max_length=2000)
    gait: str | None = Field(default=None, max_length=2000)
    defects: str | None = Field(default=None, max_length=2000)
    manual: str | None = Field(default=None, max_length=2000)


class ReportInputsIn(_In):
    language: Language | None = None
    rubric_variant: RubricVariant | None = None
    names: NamesIn | None = None
    observations: ObservationsIn | None = None


class FinalizeIn(_In):
    revision: int = Field(ge=0, le=MAX_SAFE_INT)
    report_inputs: ReportInputsIn | None = None
    document: DocumentBody | None = Field(
        default=None, description="optional save-and-finalize: applied first at `revision`"
    )


class CandidateRefIn(_In):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    params_hash: str = Field(pattern=r"^[0-9a-f]{16}$")
    candidate_id: str = Field(pattern=r"^c\d{2}_\d{6}$")


class SessionCreateIn(_In):
    candidate: CandidateRefIn
    camel_id: str = Field(default="", max_length=64)
    operator: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=4000)


class DepthIn(_In):
    u: float
    v: float
    target: Target = "camel"
    seq: int | None = Field(default=None, description="echoed back so stale replies are dropped")


class PreviewIn(_In):
    measurement: MeasurementInputModel
    seq: int | None = None


class FlagChip(_Out):
    code: str
    ar: str
    en: str
    severity: Literal["warn", "info"]


class DepthBasis(_Out):
    point: int | None
    ar: str
    en: str


class RejectionPart(_Out):
    point: str | None
    code: str
    ar: str
    en: str


class Presentation(_Out):
    kind_label: Bilingual
    value: float | None
    unit: Literal["m", "deg"]
    value_text: Bilingual
    uncertainty_text: Bilingual
    depth_basis: list[DepthBasis]
    flags: list[FlagChip]
    confidence: dict[str, str] | None
    rejected: bool
    rejection: list[RejectionPart]
    n_points: int
    n_points_knn: int


class DepthProvenanceOut(_Out):
    source: DepthSource | None
    depth_m: float | None
    target: Target
    inside_mask: bool
    inside_depth_bbox: bool
    window_n_total: int
    window_n_valid: int
    window_n_in_mask: int
    window_restricted_to_mask: bool
    window_median_m: float | None
    window_spread_m: float | None
    knn_depth_m: float | None
    nn_depth_mean_m: float | None
    k_requested: int
    k_used: int
    nn_dist_px_max: float | None
    nn_dist_m_max: float | None
    nn_centroid_px: Point | None
    nn_depth_spread_m: float | None
    direct_depth_m: float | None
    flags: list[str]
    reason: str


class MeasurementRow(_Out):
    """A computed row; kind-specific fields (p1_px, points_3d, segment_dz_m, …) pass
    through as additional properties."""

    id: int
    kind: MeasurementKind
    family: Family
    input_kind: InputKind
    input: MeasurementInputModel
    name: str
    order: int
    display_color: str
    note: str
    targets: list[Target]
    rejection_reason: str
    confidence: Confidence | None
    flags: list[str]
    created_at: str
    presentation: Presentation


class SessionSummary(_Out):
    n_measurements: int
    n_rejected: int
    n_low_confidence: int
    n_points: int
    n_points_knn: int
    snapped_text: Bilingual


class FrameAssets(_Out):
    rgb: str
    mask: str
    thumb: str
    depth: str


class FrameBag(_Out):
    name: str | None
    path: str | None
    fingerprint: str | None
    read_index: int | None
    frame_number_color: int | None
    frame_number_depth: int | None
    bag_time_s: float | None
    bucket: Bucket | None


class FrameInfo(_Out):
    width: int
    height: int
    z_ref: dict[str, Any]
    ground: dict[str, Any]
    depth_valid_bbox: list[int] | None
    knn: dict[str, Any]
    intrinsics: dict[str, Any]
    candidate: dict[str, Any]
    model: dict[str, Any]
    bag: FrameBag
    assets: FrameAssets


class OverlayOutput(_Out):
    version: int
    file: str
    sha256: str
    width: int | None
    height: int | None
    url: str


class ReportModelOutput(_Out):
    version: int = Field(description="new on every finalize and every report-input change")
    file: str
    sha256: str | None = Field(description="send it back as X-Report-Model-Sha256 on upload")
    url: str


class ReportOutput(_Out):
    version: int
    file: str
    sha256: str | None
    url: str
    overlay_version: int = Field(description="the overlay version this PDF was sealed with")
    report_model_version: int = Field(description="the report model version it carries")
    stale: bool = Field(description="true when it no longer shows the current outputs")


class Outputs(_Out):
    overlay: OverlayOutput | None
    report_model: ReportModelOutput | None
    report: ReportOutput | None
    manifest_url: str | None


class ReportInputsOut(_Out):
    language: Language
    rubric_variant: RubricVariant
    names: dict[str, str]
    observations: dict[str, str]


class SessionView(_Out):
    session_id: str
    camel_id: str
    operator: str
    notes: str
    status: Status
    revision: int
    outputs_stale: bool
    report_stale: bool
    created_at: str
    updated_at: str
    next_measurement_id: int
    measurements: list[MeasurementRow]
    summary: SessionSummary
    frame: FrameInfo
    outputs: Outputs
    report_inputs: ReportInputsOut
    required_report_texts: list[str] = Field(
        description=(
            "strings the PDF text probe requires (measurement names, judge / council / event, "
            "camel id); render each in an embedded face, never a synthesized bold"
        )
    )
    library_versions: dict[str, Any]
    index_state: IndexState | None = None


class DepthOut(DepthProvenanceOut):
    seq: int | None
    basis: Bilingual
    ok: bool


class PreviewOut(_Out):
    seq: int | None
    row: MeasurementRow


class ReportOut(_Out):
    session: SessionView
    probe: dict[str, Any]


class HistoryRow(_Out):
    session_id: str
    camel_id: str
    operator: str
    status: str
    revision: int
    created_at: str
    updated_at: str
    bag_name: str | None
    bag_path: str | None
    bag_fingerprint: str | None
    read_index: int | None
    n_measurements: int
    n_rejected: int
    outputs_stale: bool
    report_stale: bool
    overlay_version: int
    report_version: int
    index_state: str
    index_error: str
    thumb_url: str | None
    session_url: str


class HistoryList(_Out):
    items: list[HistoryRow]
    total: int
    reconciled: dict[str, int]


class DeleteOut(_Out):
    deleted: bool
    trashed_to: str | None


class BackupIn(_In):
    path: str | None = Field(default=None, max_length=4096)


class BackupOut(_Out):
    path: str
    bytes: int


class HistoryStats(_Out):
    sessions: dict[str, int]
    candidates: dict[str, int]
    trash: dict[str, int]
    index: dict[str, Any]
    backups: dict[str, int]
