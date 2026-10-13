from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import candidate_cache as cache
from nazeer_engine import candidates as cd
from nazeer_engine import fsio
from nazeer_engine.bagreader import BagInfo, FramePair, WalkSummary
from nazeer_engine.errors import (
    Conflict,
    JobCancelled,
    JobStopped,
    ModelContractError,
    NotFound,
    Unprocessable,
)
from nazeer_engine.frames import load_bundle
from nazeer_engine.jobs import CandidateJobManager
from nazeer_engine.segmenter import Detection, StubSegmenter, detection_from_mask
from tests.synthetic import INTRINSICS

H, W = 120, 200


def _mask(kind: str, *, margin: bool = False, cut: bool = False, area: str = "ok") -> np.ndarray:
    mask = np.zeros((H, W), dtype=np.uint8)
    if kind == "side":
        mask[30:70, 40:160] = 255  # 40 x 120 -> aspect 3.0
    elif kind == "end":
        mask[20:100, 80:120] = 255  # 80 x 40 -> aspect 0.5
    else:
        mask[30:90, 60:140] = 255  # 60 x 80 -> aspect 1.33 (QUARTER)
    if margin:
        mask[30:70, 2:160] = 255  # inside the image, in the 8 px depth-FOV margin (soft flag)
    if cut:
        mask[30:70, 0:160] = 255  # touches the left image border: the camel is cut off
    if area == "tiny":
        mask[:] = 0
        mask[50:54, 90:94] = 255
    if area == "huge":
        mask[:] = 255
    return mask


def _pair(index: int, *, z_mean: float = 2.0, z_sigma: float = 0.02) -> FramePair:
    rng = np.random.default_rng(index)
    depth = (z_mean + rng.normal(0.0, z_sigma, size=(H, W))).astype(np.float32)
    depth[:12, :] = 0.0  # a dead top band so the depth-valid bbox is not the full frame
    bgr = np.zeros((H, W, 3), dtype=np.uint8)
    bgr[0, 0, 0] = index % 256  # the stub segmenter reads the index back from the pixels
    bgr[0, 0, 1] = index // 256
    return FramePair(
        read_index=index,
        frame_number_color=25979 + index,
        frame_number_depth=25844 + index,
        color_timestamp_ms=1.776e12 + index * 33.3,
        bag_time_s=index / 30.0,
        bgr=bgr,
        depth_m=depth,
        intrinsics=dict(INTRINSICS),
        depth_units_m=0.001,
    )


def _index_of(bgr: np.ndarray) -> int:
    return int(bgr[0, 0, 0]) + 256 * int(bgr[0, 0, 1])


class Scenario:
    """Every ``every``-th raw frame is sampled; frame k = index // every behaves by k % 12:
    11 no detection, 10 mask cut by the image border, 9 z_mean 0.8 m, 8 z_mean 1.2 m, else a
    passing SIDE frame (END when k % 4 == 3) with noise sigma 0.01 + 0.001 * (k % 7)."""

    def __init__(self, n_raw: int = 1200, every: int = 20, *, all_pass: bool = False) -> None:
        self.n_raw = n_raw
        self.every = every
        self.all_pass = all_pass

    def spec(self, index: int) -> tuple[str | None, float, float, bool]:
        k = index // self.every
        sigma = 0.01 + 0.001 * (k % 7)
        if self.all_pass:
            return "side", 2.0, sigma, False
        r = k % 12
        if r == 11:
            return None, 2.0, 0.02, False
        if r == 10:
            return "side", 2.0, 0.02, True
        if r == 9:
            return "side", 0.8, 0.02, False
        if r == 8:
            return "side", 1.2, 0.02, False
        return ("end" if k % 4 == 3 else "side"), 2.0, sigma, False

    def pair(self, index: int) -> FramePair:
        _kind, z, sigma, _inc = self.spec(index)
        return _pair(index, z_mean=z, z_sigma=sigma)

    def mask(self, index: int) -> np.ndarray | None:
        kind, _z, _s, cut = self.spec(index)
        return None if kind is None else _mask(kind, cut=cut)


class FakeWalk:
    """Stands in for ``bagreader.walk_bag``: same events, same summary, lazily built pairs."""

    def __init__(
        self, scenario: Scenario, *, sample_every, cancel=None, stop=None, on_progress=None
    ):
        self.scenario = scenario
        self.sample_every = sample_every
        self.cancel = cancel
        self.stop = stop
        self.on_progress = on_progress
        self.summary = WalkSummary(
            sample_every=sample_every, fps=30, n_frames_estimate=scenario.n_raw
        )
        self.closed = False
        self._gen = self._run()

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._gen)

    def close(self) -> None:
        self.closed = True
        self._gen.close()

    def _run(self):
        for index in range(self.scenario.n_raw):
            if self.cancel is not None and self.cancel.is_set():
                self.summary.end_reason = "cancelled"
                raise JobCancelled()
            if self.stop is not None and self.stop.is_set():
                self.summary.end_reason = "stopped"
                raise JobStopped()
            self.summary.n_pairs = index + 1
            self.summary.last_position_fraction = (index + 1) / self.scenario.n_raw
            if self.on_progress:
                self.on_progress(index, self.summary.last_position_fraction)
            if index % self.sample_every:
                continue
            self.summary.n_sampled += 1
            yield self.scenario.pair(index)
        self.summary.end_reason = "eof"
        self.summary.walk_complete = True


def _bag_iter_factory(scenario: Scenario, walks: list | None = None):
    def factory(_bag, *, sample_every, cancel=None, stop=None, on_progress=None):
        walk = FakeWalk(
            scenario, sample_every=sample_every, cancel=cancel, stop=stop, on_progress=on_progress
        )
        if walks is not None:
            walks.append(walk)
        return walk

    return factory


def _segmenter(scenario: Scenario, *, delay_s: float = 0.0) -> StubSegmenter:
    def fn(bgr: np.ndarray) -> Detection:
        if delay_s:
            time.sleep(delay_s)
        m = scenario.mask(_index_of(bgr))
        if m is None:
            return Detection(ok=False, reason="no_detection")
        return detection_from_mask(m, conf=0.9)

    return StubSegmenter(fn)


def _info(bag: Path, n_raw: int) -> BagInfo:
    return BagInfo(
        path=str(bag),
        name=bag.name,
        size_bytes=bag.stat().st_size,
        mtime_ns=bag.stat().st_mtime_ns,
        fingerprint=fsio.bag_fingerprint(bag),
        duration_s=n_raw / 30.0,
        device_name="fake",
        color={"width": W, "height": H, "fps": 30, "format": "format.rgb8"},
        depth={"width": W, "height": H, "fps": 30, "format": "format.z16"},
        depth_units_m=0.001,
        intrinsics=dict(INTRINSICS),
        n_frames_estimate=n_raw,
        sample_every_effective=5,
    )


@pytest.fixture
def bag(tmp_path: Path) -> Path:
    folder = tmp_path / "اختبار"
    folder.mkdir()
    path = folder / "fake.bag"
    path.write_bytes(os.urandom(64 * 1024))
    return path


# ----- params --------------------------------------------------------------------------------


def test_params_validation_and_hash():
    with pytest.raises(Unprocessable):
        cd.CandidateParams(z_mean_min_m=0.9).validated()  # the operator's 1 m floor
    with pytest.raises(Unprocessable):
        cd.CandidateParams(m=0).validated()
    with pytest.raises(Unprocessable):
        cd.CandidateParams(m=49).validated()
    with pytest.raises(Unprocessable):
        cd.CandidateParams(minority_reserve=13).validated()
    p = cd.CandidateParams.from_dict({"m": 6, "z_median_min_m": 1.0}, model_sha256="abc")
    assert p.m == 6 and p.model_sha256 == "abc" and p.depth_band == (0.3, 5.0)
    assert p.hash() == cd.CandidateParams.from_dict(p.to_dict()).hash()
    assert p.hash() != cd.CandidateParams.from_dict({"m": 7}, model_sha256="abc").hash()
    assert len(p.hash()) == 16


# ----- per-frame evaluation ------------------------------------------------------------------


def test_evaluate_frame_reasons_and_stats():
    params = cd.CandidateParams()
    ok = cd.evaluate_frame(_pair(0), detection_from_mask(_mask("side")), params)
    assert ok.passed and ok.bucket == "SIDE" and ok.rejection_reasons == []
    assert ok.aspect_wh == pytest.approx(3.0)
    assert abs(ok.z_mean - 2.0) < 0.01 and ok.z_var is not None and ok.n_valid > 0
    assert ok.bbox_yolo_xyxy == [40.0, 30.0, 160.0, 70.0]
    assert ok.bbox_mask_xyxy == [40, 30, 159, 69]
    assert ok.bbox_agreement_iou == pytest.approx(1.0)
    assert ok.depth_valid_bbox == [0, 12, W - 1, H - 1]
    end = cd.evaluate_frame(_pair(1), detection_from_mask(_mask("end")), params)
    assert end.passed and end.bucket == "END" and end.aspect_wh == pytest.approx(0.5)
    quarter = cd.evaluate_frame(_pair(2), detection_from_mask(_mask("quarter")), params)
    assert quarter.passed and quarter.bucket == "QUARTER"  # a badge, never a rejection
    none = cd.evaluate_frame(_pair(3), Detection(ok=False, reason="no_detection"), params)
    assert none.rejection_reasons == ["no_detection"] and not none.detected
    margin = detection_from_mask(_mask("side", margin=True))
    soft = cd.evaluate_frame(_pair(4), margin, params)
    assert soft.passed and soft.frame_clear and soft.flags == ["mask_in_depth_margin"]
    assert not soft.depth_fov_complete and soft.completeness_violations["left"] == 6
    strict = cd.evaluate_frame(_pair(4), margin, cd.CandidateParams(strict_depth_fov=True))
    assert strict.rejection_reasons == ["mask_incomplete"] and strict.flags == []
    cut_det = detection_from_mask(_mask("side", cut=True))
    cut = cd.evaluate_frame(_pair(4), cut_det, params)
    assert cut.rejection_reasons == ["mask_cut_by_frame"] and not cut.complete
    assert cut.frame_violations == {"left": 1, "top": 0, "right": 0, "bottom": 0}
    unguarded = cd.evaluate_frame(_pair(4), cut_det, cd.CandidateParams(frame_margin_px=0))
    assert unguarded.passed and unguarded.flags == ["mask_in_depth_margin"]
    assert ok.frame_clear and ok.depth_fov_complete and ok.flags == []
    floor = cd.evaluate_frame(_pair(5, z_mean=0.8), detection_from_mask(_mask("side")), params)
    assert floor.rejection_reasons == ["z_mean_below_floor", "z_median_below_min"]
    mid = cd.evaluate_frame(_pair(6, z_mean=1.2), detection_from_mask(_mask("side")), params)
    assert mid.rejection_reasons == ["z_median_below_min"]
    relaxed = cd.CandidateParams(z_median_min_m=1.0)
    assert cd.evaluate_frame(
        _pair(6, z_mean=1.2), detection_from_mask(_mask("side")), relaxed
    ).passed
    tiny = cd.evaluate_frame(_pair(7), detection_from_mask(_mask("side", area="tiny")), params)
    assert "mask_area_out_of_range" in tiny.rejection_reasons
    huge = cd.evaluate_frame(_pair(8), detection_from_mask(_mask("side", area="huge")), params)
    assert "mask_area_out_of_range" in huge.rejection_reasons
    pair = _pair(9)
    pair.depth_m[:] = 0.0
    nodepth = cd.evaluate_frame(pair, detection_from_mask(_mask("side")), params)
    assert "no_valid_depth_in_mask" in nodepth.rejection_reasons and nodepth.z_var is None
    holes = _pair(10)
    holes.depth_m[30:70, 40:130] = 0.0  # most of the mask has no depth
    sparse = cd.evaluate_frame(holes, detection_from_mask(_mask("side")), params)
    assert sparse.rejection_reasons == ["valid_frac_too_low"] and sparse.valid_frac < 0.6


def test_evaluate_frame_z_var_is_the_operator_depth_mse():
    pair = _pair(11, z_sigma=0.03)
    stats = cd.evaluate_frame(pair, detection_from_mask(_mask("side")), cd.CandidateParams())
    from nazeer_engine.maskstats import erode_mask

    eroded = erode_mask(_mask("side"), 2) != 0
    values = pair.depth_m[eroded].astype(np.float64)
    assert stats.z_var == pytest.approx(float(np.mean((values - values.mean()) ** 2)))
    assert stats.z_mean == pytest.approx(float(values.mean()))


# ----- holders and ranking -------------------------------------------------------------------


def _holder(index: int, z_var: float, bucket: str = "SIDE", bin_sec: float = 1.5) -> cd.Holder:
    stats = cd.FrameStats(
        read_index=index,
        frame_number_color=0,
        frame_number_depth=0,
        color_timestamp_ms=0.0,
        bag_time_s=index / 30,
    )
    stats.z_var = z_var
    stats.rel_disp = z_var
    stats.bucket = bucket
    stats.passed = True
    return cd.Holder(
        bin=int((index / 30) // bin_sec),
        stats=stats,
        bgr=np.zeros((2, 2, 3), np.uint8),
        depth_m=np.zeros((2, 2), np.float32),
        mask=np.zeros((2, 2), np.uint8),
        intrinsics={},
        depth_units_m=0.001,
    )


def test_holder_set_one_per_bin_replace_and_cap():
    hs = cd.HolderSet(cap=3)
    assert hs.offer(_holder(0, 0.5)) and hs.offer(_holder(45, 0.4)) and hs.offer(_holder(90, 0.3))
    assert not hs.offer(_holder(10, 0.6))  # same bin (0) but worse
    assert hs.offer(_holder(10, 0.1)) and hs.replaced == 1 and hs.by_bin[0].stats.read_index == 10
    assert not hs.offer(_holder(135, 0.9))  # cap reached and worse than the worst
    assert hs.offer(_holder(135, 0.2)) and hs.evicted == 1 and len(hs.holders()) == 3
    assert {h.bin for h in hs.holders()} == {0, 2, 3}


def test_rank_and_select_reserves_minority_bucket():
    holders = [_holder(i * 45, 0.01 + 0.001 * i, "SIDE") for i in range(10)]
    holders += [_holder(1000 + i * 45, 0.5 + 0.01 * i, "END") for i in range(3)]
    selected, diag = cd.rank_and_select(holders, m=12, reserve=2)
    assert len(selected) == 12 and diag["minority_bucket"] == "END"
    assert sum(1 for h in selected if h.stats.bucket == "END") == 2
    assert diag["minority_reserved"] == 2 and diag["minority_reserved_shortfall"] == 0
    assert diag["minority_swapped_in"] == 0  # the top 12 already held two END frames
    assert [h.stats.z_var for h in selected] == sorted(h.stats.z_var for h in selected)
    # 14 SIDE + 3 END with m = 12: the two best END frames replace the two worst SIDE picks
    many = [_holder(i * 45, 0.01 + 0.001 * i, "SIDE") for i in range(14)]
    many += [_holder(1000 + i * 45, 0.5 + 0.01 * i, "END") for i in range(3)]
    sel_m, diag_m = cd.rank_and_select(many, m=12, reserve=2)
    assert len(sel_m) == 12 and diag_m["minority_swapped_in"] == 2
    assert sorted(h.stats.z_var for h in sel_m if h.stats.bucket == "END") == [0.5, 0.51]
    assert max(h.stats.z_var for h in sel_m if h.stats.bucket == "SIDE") == pytest.approx(0.019)
    only_side = [_holder(i * 45, 0.01 + 0.001 * i, "SIDE") for i in range(5)]
    sel2, diag2 = cd.rank_and_select(only_side, m=12, reserve=2)
    assert len(sel2) == 5 and diag2["minority_bucket"] is None
    one_end = only_side + [_holder(900, 0.9, "END")]
    sel3, diag3 = cd.rank_and_select(one_end, m=4, reserve=2)
    assert diag3["minority_reserved_shortfall"] == 1 and len(sel3) == 4
    assert sum(1 for h in sel3 if h.stats.bucket == "END") == 1
    quarters = [_holder(2000 + i * 45, 0.01 * (i + 1), "QUARTER") for i in range(3)]
    sel4, diag4 = cd.rank_and_select(only_side + quarters, m=12, reserve=2)
    assert diag4["minority_bucket"] is None and len(sel4) == 8


def test_the_minority_is_the_bucket_the_pick_starves():
    """Review #7: decided from the top-M pick, not from population counts."""
    # 20 SIDE + 20 END, SIDE steadier: a population tie, but the pick would be all SIDE
    tie = [_holder(i * 45, 0.01 + 0.0001 * i, "SIDE") for i in range(20)]
    tie += [_holder(5000 + i * 45, 0.1 + 0.0001 * i, "END") for i in range(20)]
    sel, diag = cd.rank_and_select(tie, m=12, reserve=2)
    assert diag["minority_bucket"] == "END" and diag["minority_swapped_in"] == 2
    assert sum(1 for h in sel if h.stats.bucket == "END") == 2 and len(sel) == 12
    # 12 END hold the lowest z_var among 42 frames: SIDE (the population majority) is starved
    ends = [_holder(i * 45, 0.001 * (i + 1), "END") for i in range(12)]
    sides = [_holder(5000 + i * 45, 0.5 + 0.001 * i, "SIDE") for i in range(30)]
    sel2, diag2 = cd.rank_and_select(ends + sides, m=12, reserve=2)
    assert diag2["minority_bucket"] == "SIDE"
    assert sum(1 for h in sel2 if h.stats.bucket == "SIDE") == 2


def test_picks_keep_the_temporal_gap_across_bin_edges():
    """Review #8: read index 44 and 45 sit in different 1.5 s bins but 33 ms apart."""
    close = [_holder(44, 0.01, "SIDE"), _holder(45, 0.02, "SIDE"), _holder(200, 0.03, "SIDE")]
    assert close[0].bin != close[1].bin
    sel, diag = cd.rank_and_select(close, m=12, reserve=2)
    assert [h.stats.read_index for h in sel] == [44, 200] and diag["skipped_too_close"] == 1
    gaps = [
        abs(a.stats.read_index - b.stats.read_index) / 30 for a in sel for b in sel if a is not b
    ]
    assert min(gaps) >= 1.5
    # a reserved minority frame must keep the gap too: END at 46 cannot join SIDE at 44
    with_end = [*close, _holder(46, 0.5, "END"), _holder(900, 0.6, "END")]
    sel2, diag2 = cd.rank_and_select(with_end, m=2, reserve=1)
    assert [h.stats.read_index for h in sel2] == [44, 900]
    assert diag2["minority_bucket"] == "END" and diag2["minority_swapped_in"] == 1


# ----- the walk end to end -----------------------------------------------------------------


def test_run_candidate_walk_persists_ranked_candidates(bag: Path, tmp_path: Path):
    scenario = Scenario(1200, 20)
    root = tmp_path / "root"
    params = cd.CandidateParams(sample_every=20, model_sha256="stub")
    events: list[dict] = []
    walks: list[FakeWalk] = []
    result = cd.run_candidate_walk(
        bag,
        params,
        segmenter=_segmenter(scenario),
        cache_root=root,
        job_id="job1",
        bag_iter=_bag_iter_factory(scenario, walks),
        bag_info=_info(bag, 1200),
        progress=events.append,
        library_versions={"numpy": "x"},
    )
    assert walks[0].closed
    assert result.directory == cache.result_dir(root, result.fingerprint, params.hash())
    assert cache.result_exists(result.directory)
    assert not list((root / "candidates" / result.fingerprint).glob(".building_*"))
    cj = result.candidates_json
    assert cj["candidates_version"] == "1.0" and cj["params_hash"] == params.hash()
    assert cj["sample_every_effective"] == 20 and cj["walk"]["n_sampled"] == 60
    assert cj["walk"]["n_pairs"] == 1200 and cj["walk"]["end_reason"] == "eof"
    assert cj["walk"]["walk_complete"] and not cj["walk"]["slow_media"]
    rejected = cj["rejected_by_reason"]
    assert rejected["no_detection"] == 5 and rejected["z_mean_below_floor"] == 5
    assert rejected["mask_cut_by_frame"] == 5 and rejected["mask_incomplete"] == 0
    assert rejected["z_median_below_min"] == 10
    assert cj["n_candidates"] == 12 and not cj["partial"] and cj["presentation"] == "unordered"
    z_vars = [c["z_var"] for c in cj["candidates"]]
    assert z_vars == sorted(z_vars) and all(c["z_mean"] >= 1.0 for c in cj["candidates"])
    assert sum(1 for c in cj["candidates"] if c["bucket"] == "END") >= 2
    bins = {int((c["read_index"] / 30) // 1.5) for c in cj["candidates"]}
    assert len(bins) == 12  # one candidate per 1.5 s bin (temporal diversity)
    assert len(cj["frames"]) == 60 and len(cj["near_misses"]) == 10
    assert all(set(n["rejection_reasons"]) <= cd.TUNABLE_REASONS for n in cj["near_misses"])
    assert cj["model"] == {"file": "stub", "sha256": "stub", "stub": True}
    first = cj["candidates"][0]
    assert first["rank"] == 1 and first["candidate_id"].startswith("c01_")
    bundle = load_bundle(result.directory / first["dir"])
    assert bundle.shape == (H, W) and bundle.stats["candidate_id"] == first["candidate_id"]
    assert bundle.intrinsics["depth_valid_bbox"] == [0, 12, W - 1, H - 1]
    assert bundle.intrinsics["depth_units_m"] == 0.001
    assert (result.directory / first["assets"]["thumb"]).stat().st_size > 0
    stages = [e["stage"] for e in events]
    assert stages[0] == "opening" and stages[-1] == "done"
    assert "ranking" in stages and "persisting" in stages
    assert fsio.read_json(result.directory / "candidates.json")["n_candidates"] == 12
    assert cd.load_candidates(root, result.fingerprint, params.hash())["n_candidates"] == 12
    assert cd.load_candidates(root, "nope", params.hash()) is None


def test_a_walk_with_the_ellipse_stub_proposes_frames_under_its_own_identity(bag, tmp_path):
    from nazeer_engine.segmenter import stub_ellipse_detection

    scenario = Scenario(1200, 20, all_pass=True)  # depth 2 m everywhere but the dead top band
    root = tmp_path / "root"
    stub = StubSegmenter(stub_ellipse_detection, name="stub-ellipse")
    params = cd.CandidateParams(sample_every=20, model_sha256=stub.sha256)
    assert params.hash() != cd.CandidateParams(sample_every=20, model_sha256="stub").hash()
    result = cd.run_candidate_walk(
        bag,
        params,
        segmenter=stub,
        cache_root=root,
        job_id="job1",
        bag_iter=_bag_iter_factory(scenario),
        bag_info=_info(bag, 1200),
        progress=lambda _e: None,
        library_versions={"numpy": "x"},
    )
    cj = result.candidates_json
    assert cj["model"] == {"file": "stub-ellipse", "sha256": "stub-ellipse", "stub": True}
    assert cj["walk"]["n_sampled"] == 60 and sum(cj["rejected_by_reason"].values()) == 0
    assert cj["n_candidates"] == 12 and stub.calls == 60
    assert all(c["bucket"] == "QUARTER" for c in cj["candidates"])  # 120 x 84 px: aspect 1.43


def test_walk_stop_persists_best_so_far_and_cancel_leaves_nothing(bag: Path, tmp_path: Path):
    scenario = Scenario(1200, 20)
    root = tmp_path / "root"
    params = cd.CandidateParams(sample_every=20, model_sha256="stub")
    stop = threading.Event()

    def stopping_progress(event: dict) -> None:
        if event["stage"] == "walking" and event.get("read_index", 0) >= 299:
            stop.set()

    result = cd.run_candidate_walk(
        bag,
        params,
        segmenter=_segmenter(scenario),
        cache_root=root,
        job_id="job2",
        bag_iter=_bag_iter_factory(scenario),
        bag_info=_info(bag, 1200),
        stop=stop,
        progress=stopping_progress,
    )
    cj = result.candidates_json
    assert cj["partial"] and cj["walk"]["stopped_early"]
    assert "stopped_early" in cj["shortfall_reasons"]
    assert 0 < cj["n_candidates"] < 12 and cj["walk"]["end_reason"] == "stopped"
    assert not cj["walk"]["walk_complete"]
    cancel = threading.Event()

    def cancelling_progress(event: dict) -> None:
        if event["stage"] == "walking" and event.get("read_index", 0) >= 100:
            cancel.set()

    with pytest.raises(JobCancelled):
        cd.run_candidate_walk(
            bag,
            params,
            segmenter=_segmenter(scenario),
            cache_root=root,
            job_id="job3",
            bag_iter=_bag_iter_factory(scenario),
            bag_info=_info(bag, 1200),
            cancel=cancel,
            progress=cancelling_progress,
        )
    assert not cache.building_dir(root, result.fingerprint, "job3").exists()


def test_walk_model_contract_error_fails_with_read_index_and_closes_walk(bag, tmp_path):
    scenario = Scenario(1200, 20)
    walks: list[FakeWalk] = []

    def fn(_bgr):
        raise ModelContractError("bad mask", details={"mask_shape": [1, 1]})

    with pytest.raises(ModelContractError) as info:
        cd.run_candidate_walk(
            bag,
            cd.CandidateParams(sample_every=20),
            segmenter=StubSegmenter(fn),
            cache_root=tmp_path / "root",
            job_id="job4",
            bag_iter=_bag_iter_factory(scenario, walks),
            bag_info=_info(bag, 1200),
        )
    assert "read_index" in info.value.details and walks[0].closed


def test_walk_closes_the_bag_on_unexpected_consumer_errors(bag, tmp_path):
    scenario = Scenario(1200, 20)
    walks: list[FakeWalk] = []

    def fn(_bgr):
        raise RuntimeError("segmenter crashed")

    with pytest.raises(RuntimeError):
        cd.run_candidate_walk(
            bag,
            cd.CandidateParams(sample_every=20),
            segmenter=StubSegmenter(fn),
            cache_root=tmp_path / "root",
            job_id="job5",
            bag_iter=_bag_iter_factory(scenario, walks),
            bag_info=_info(bag, 1200),
        )
    assert walks[0].closed


# ----- cache ---------------------------------------------------------------------------------


def test_publish_over_existing_dir_and_lru_purge(tmp_path: Path):
    root = tmp_path / "root"
    final = cache.result_dir(root, "fp1", "ph1")
    final.mkdir(parents=True)
    (final / "candidates.json").write_bytes(b"{}")
    (final / "old.bin").write_bytes(b"x" * 100)
    tmp = cache.building_dir(root, "fp1", "jobA")
    tmp.mkdir(parents=True)
    (tmp / "candidates.json").write_bytes(b'{"new": true}')
    cache.publish(tmp, final)
    assert (final / "candidates.json").read_bytes() == b'{"new": true}'
    assert not (final / "old.bin").exists() and not tmp.exists()
    assert not list(final.parent.glob("*.old_*"))
    for i, name in enumerate(("a", "b", "c")):
        d = cache.result_dir(root, f"fp{i}", name)
        d.mkdir(parents=True, exist_ok=True)
        (d / "candidates.json").write_bytes(b"x" * 1000)
        stamp = time.time() - 1000 + i * 10
        os.utime(d, (stamp, stamp))
    assert cache.cache_stats(root)["count"] == 4
    purged = cache.purge_lru(root, max_bytes=2500, keep=cache.result_dir(root, "fp0", "a"))
    assert cache.result_dir(root, "fp0", "a").exists()  # kept although it is the oldest
    assert cache.result_dir(root, "fp2", "c").exists()
    assert not cache.result_dir(root, "fp1", "b").exists()
    assert purged["removed"] == [str(cache.result_dir(root, "fp1", "b"))]
    assert purged["bytes_after"] <= 2500
    assert cache.params_hash({"a": 1, "b": [1, 2]}) == cache.params_hash({"b": [1, 2], "a": 1})


def test_purge_building_dirs(tmp_path: Path):
    root = tmp_path / "root"
    cache.building_dir(root, "fp", "j1").mkdir(parents=True)
    (cache.result_dir(root, "fp", "ph").with_name("ph.old_1")).mkdir(parents=True)
    cache.result_dir(root, "fp", "ph").mkdir(parents=True)
    assert cache.purge_building_dirs(root) == 2
    assert cache.result_dir(root, "fp", "ph").exists()


# ----- job manager ---------------------------------------------------------------------------


def _manager(bag: Path, tmp_path: Path, scenario: Scenario, *, delay_s: float = 0.0):
    return CandidateJobManager(
        tmp_path / "root",
        _segmenter(scenario, delay_s=delay_s),
        bag_iter=_bag_iter_factory(scenario),
        inspect=lambda _p: _info(bag, scenario.n_raw),
    )


def test_job_manager_runs_to_done_then_cache_hits(bag: Path, tmp_path: Path):
    scenario = Scenario(1200, 20)
    mgr = _manager(bag, tmp_path, scenario)
    params = cd.CandidateParams(sample_every=20, model_sha256="stub")
    state, cached = mgr.start(bag, params)
    assert cached is None and state["state"] in ("queued", "running") and state["job_id"]
    mgr.wait(60)
    final = mgr.get(state["job_id"])
    assert final["state"] == "done" and final["terminal"] and final["progress_fraction"] == 1.0
    assert final["result"]["n_candidates"] == 12 and final["result"]["params_hash"] == params.hash()
    assert final["counters"]["read"] == 1200 and final["finished_at"] and final["eta_s"] is None
    # C2.8: the snapshot carries the rejections by reason (review #19)
    assert final["counters"]["rejected_by_reason"]["no_detection"] == 5
    assert final["counters"]["rejected_by_reason"]["mask_cut_by_frame"] == 5
    state2, cached2 = mgr.start(bag, params)
    assert state2 is None and cached2["cached"] and cached2["params_hash"] == params.hash()
    assert cached2["n_candidates"] == 12 and cached2["partial"] is False
    state3, _ = mgr.start(bag, params, force=True)
    assert state3 is not None
    mgr.wait(60)
    assert mgr.get(state3["job_id"])["state"] == "done"
    assert mgr.active()["job_id"] == state3["job_id"]
    with pytest.raises(NotFound):
        mgr.get("nope")


def test_job_manager_busy_cancel_stop_and_failure(bag: Path, tmp_path: Path):
    scenario = Scenario(3000, 5, all_pass=True)
    mgr = _manager(bag, tmp_path, scenario, delay_s=0.01)
    params = cd.CandidateParams(sample_every=5, model_sha256="stub")
    state, _ = mgr.start(bag, params)
    with pytest.raises(Conflict) as busy:
        mgr.start(bag, cd.CandidateParams(sample_every=10, model_sha256="stub"))
    assert busy.value.code == "job_busy"
    time.sleep(0.3)
    snap = mgr.get(state["job_id"])
    assert snap["state"] in ("running", "queued") and not snap["terminal"]
    assert snap["counters"]["read"] > 0
    cancelled = mgr.cancel(state["job_id"])
    assert cancelled["state"] == "cancelling" and not cancelled["terminal"]
    mgr.wait(60)
    assert mgr.get(state["job_id"])["state"] == "cancelled"
    assert not list((tmp_path / "root" / "candidates").rglob(".building_*"))
    state2, _ = mgr.start(bag, params)
    time.sleep(0.3)
    mgr.stop(state2["job_id"])
    mgr.wait(60)
    done = mgr.get(state2["job_id"])
    assert done["state"] == "done" and done["result"]["partial"] is True
    # review #9: the stopped walk stays viewable, but the same params never hit it as a cache
    state_again, cached_again = mgr.start(bag, params)
    assert cached_again is None and state_again is not None
    mgr.cancel(state_again["job_id"])
    mgr.wait(60)

    def failing(_bgr):
        raise RuntimeError("boom")

    mgr3 = CandidateJobManager(
        tmp_path / "root3",
        StubSegmenter(failing),
        bag_iter=_bag_iter_factory(scenario),
        inspect=lambda _p: _info(bag, scenario.n_raw),
    )
    state3, _ = mgr3.start(bag, params)
    mgr3.wait(60)
    failed = mgr3.get(state3["job_id"])
    assert failed["state"] == "failed" and failed["error"]["code"] == "internal_error"
    assert failed["error"]["details"]["type"] == "RuntimeError"  # uniform with the API errors
    assert failed["terminal"]
