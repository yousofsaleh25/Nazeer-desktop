from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

from nazeer_engine import jsonsafe


def test_numpy_scalars_become_python_types():
    out = jsonsafe.to_finite({"a": np.float32(1.5), "b": np.int64(3), "c": np.bool_(True)})
    assert out == {"a": 1.5, "b": 3, "c": True}
    assert type(out["a"]) is float and type(out["b"]) is int and type(out["c"]) is bool


def test_non_finite_floats_become_null():
    out = jsonsafe.to_finite([float("nan"), float("inf"), -float("inf"), np.float64("nan"), 2.0])
    assert out == [None, None, None, None, 2.0]


def test_nested_containers_arrays_paths_tuples():
    out = jsonsafe.to_finite(
        {"arr": np.array([[1, 2], [3, 4]], dtype=np.int32), "t": (1.0, 2.0), "p": Path("x/y")}
    )
    assert out == {"arr": [[1, 2], [3, 4]], "t": [1.0, 2.0], "p": "x/y"} or out["p"] == str(
        Path("x/y")
    )


def test_to_dict_and_dataclasses_are_honoured():
    class Row:
        def to_dict(self):
            return {"v": np.float32(0.25), "nan": float("nan")}

    @dataclass
    class D:
        x: float
        y: str

    assert jsonsafe.to_finite(Row()) == {"v": 0.25, "nan": None}
    assert jsonsafe.to_finite(D(1.0, "a")) == {"x": 1.0, "y": "a"}


def test_bytes_and_unknown_objects_raise():
    with pytest.raises(TypeError):
        jsonsafe.to_finite(b"bytes")
    with pytest.raises(TypeError):
        jsonsafe.to_finite(object())


def test_dumps_never_emits_nan_tokens_and_keeps_arabic():
    text = jsonsafe.dumps({"name": "ارتفاع الحارك", "v": float("nan")})
    assert "NaN" not in text and "ارتفاع" in text
    assert json.loads(text) == {"name": "ارتفاع الحارك", "v": None}


def test_raw_json_dumps_with_allow_nan_false_is_the_tripwire():
    with pytest.raises(ValueError):
        json.dumps({"v": float("nan")}, allow_nan=False)


def test_loads_strict_rejects_bare_nan_tokens():
    with pytest.raises(ValueError):
        jsonsafe.loads_strict('{"u": NaN}')
    with pytest.raises(ValueError):
        jsonsafe.loads_strict(b'{"u": Infinity}')
    assert jsonsafe.loads_strict('{"u": 1.5}') == {"u": 1.5}


def test_dumps_canonical_is_deterministic_and_sorted():
    a = jsonsafe.dumps_canonical({"b": 1, "a": [np.float32(2.0)]})
    b = jsonsafe.dumps_canonical({"a": [2.0], "b": 1})
    assert a == b == '{"a":[2.0],"b":1}'


def test_finite_json_response_renders_normalised_payload():
    response = jsonsafe.FiniteJSONResponse({"v": np.float32(0.5), "n": float("nan")})
    assert response.body == b'{"v":0.5,"n":null}'
    assert response.media_type == "application/json"
    assert math.isfinite(0.5)
