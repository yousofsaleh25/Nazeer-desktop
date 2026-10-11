from __future__ import annotations

import pytest

from nazeer_engine.jsonsafe import dumps, loads_strict
from nazeer_engine.provenance import (
    HARD_REJECTIONS,
    SOFT_FLAGS,
    SOURCES,
    DepthProvenance,
)


def test_round_trip_every_field():
    p = DepthProvenance(
        source="knn_snapped_to_mask",
        depth_m=1.93,
        target="camel",
        inside_mask=False,
        window_n_total=25,
        window_n_valid=20,
        window_median_m=2.6,
        window_spread_m=0.02,
        knn_depth_m=1.93,
        nn_depth_mean_m=1.935,
        k_used=9,
        nn_dist_px_max=26.0,
        nn_dist_m_max=0.078,
        nn_centroid_px=(640.5, 700.25),
        nn_depth_spread_m=0.04,
        direct_depth_m=2.6,
        flags=["off_mask_surface"],
    )
    d = loads_strict(dumps(p))
    assert d["nn_centroid_px"] == [640.5, 700.25] and d["flags"] == ["off_mask_surface"]
    back = DepthProvenance.from_dict(d)
    assert back == p
    assert back.is_knn and back.ok and back.low_confidence


def test_rejected_factory_uses_closed_list():
    p = DepthProvenance.rejected("pixel_out_of_image", target="ground")
    assert p.depth_m is None and p.reason == "pixel_out_of_image" and not p.ok
    with pytest.raises(ValueError):
        DepthProvenance.rejected("something_else")


def test_vocabularies_are_closed_and_distinct():
    assert len(HARD_REJECTIONS) == 4
    assert set(SOURCES).isdisjoint(HARD_REJECTIONS)
    assert "ground_target_unresolved" in SOFT_FLAGS and "outside_depth_fov" in SOFT_FLAGS


def test_from_dict_tolerates_missing_keys():
    p = DepthProvenance.from_dict({"source": "window_median", "depth_m": 2.0})
    assert p.k_requested == 9 and p.flags == [] and p.target == "camel"
