"""Hygiene rules that are cheaper to enforce with a grep than to remember."""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1] / "nazeer_engine"
MODULES = sorted(p for p in PACKAGE.rglob("*.py"))

BANNED_EVERYWHERE = {
    "cv2.imwrite(": "use fsio.write_image (non-ASCII paths)",
    "cv2.imread(": "use fsio.read_image (non-ASCII paths)",
    "pip install": "no pip at runtime",
    "import subprocess": "no subprocesses in the engine",
    "camel_beauty": "the parent package is vendored, never imported",
    "PyQt": "no Qt in the engine",
    "open3d": "no open3d in the engine",
    "pyvista": "no pyvista in the engine",
    "localStorage": "language and names are explicit inputs",
    "playback.seek": "seek costs ~10 s; never re-fetch picks",
    "plt.": "use matplotlib.figure.Figure, never pyplot global state",
    "reportlab": "rejected by ADR-D7",
}
PRINT_ALLOWED_IN = {"__main__.py"}
HEAVY_MODULES = ("torch", "cv2", "pyrealsense2", "matplotlib", "ultralytics", "scipy")

# modules that may import only the standard library, numpy and starlette (leaf layer)
LEAF_MODULES = {
    "constants.py": set(),
    "errors.py": set(),
    "jsonsafe.py": set(),
    "versions.py": {"constants"},
    "assets.py": {"constants", "errors", "fsio"},
    "fsio.py": {"constants", "errors", "jsonsafe"},
    "logsetup.py": set(),
    "settings.py": {"constants", "errors"},
}


def _package_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level:
            if node.module:
                names.add(node.module.split(".")[0])
            else:
                for alias in node.names:
                    names.add(alias.name.split(".")[0])
        elif (
            isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith("nazeer_engine")
        ):
            names.add(node.module.split(".")[1] if "." in node.module else "")
    return {n for n in names if n}


@pytest.mark.parametrize("module", MODULES, ids=lambda p: p.name)
def test_future_annotations_and_grep_bans(module: Path):
    text = module.read_text(encoding="utf-8")
    if module.name != "__init__.py" or text.strip():
        assert "from __future__ import annotations" in text, module
    for needle, why in BANNED_EVERYWHERE.items():
        assert needle not in text, f"{module.name}: '{needle}' banned ({why})"
    if module.name not in PRINT_ALLOWED_IN:
        assert re.search(r"(?<![\w.])print\(", text) is None, f"{module.name}: print() banned"
    assert re.search(r"np\.save\(\s*str\(", text) is None, f"{module.name}: np.save(str(..))"
    assert "np.save(path" not in text and "np.save(target" not in text, module.name


@pytest.mark.parametrize("name,allowed", sorted(LEAF_MODULES.items()))
def test_leaf_modules_import_only_their_allowed_siblings(name: str, allowed: set[str]):
    path = PACKAGE / name
    if not path.exists():
        pytest.skip(f"{name} not written yet")
    imported = _package_imports(path)
    assert imported <= allowed, f"{name} imports {sorted(imported - allowed)}"


INVISIBLE_CONTROLS = (
    [chr(c) for c in range(0x200B, 0x2010)]
    + [chr(c) for c in range(0x202A, 0x202F)]
    + [chr(c) for c in range(0x2066, 0x206A)]
    + [chr(0xFEFF)]
)


@pytest.mark.parametrize(
    "module",
    sorted(PACKAGE.rglob("*.py")) + sorted((PACKAGE.parent / "tests").rglob("*.py")),
    ids=lambda p: p.name,
)
def test_no_invisible_bidi_controls_in_source(module: Path):
    """Trojan-source guard: build control characters with chr(), never type them."""
    text = module.read_text(encoding="utf-8")
    found = sorted({hex(ord(ch)) for ch in text if ch in INVISIBLE_CONTROLS})
    assert not found, f"{module.name} contains invisible control characters {found}"


def test_importing_the_package_does_not_load_heavy_libraries():
    code = (
        "import sys, nazeer_engine, nazeer_engine.constants, nazeer_engine.jsonsafe, "
        "nazeer_engine.fsio, nazeer_engine.versions, nazeer_engine.settings, "
        "nazeer_engine.assets, nazeer_engine.errors, nazeer_engine.logsetup; "
        f"print([m for m in {HEAVY_MODULES!r} if m in sys.modules])"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(PACKAGE.parent),
        check=True,
    )
    assert result.stdout.strip() == "[]", result.stdout
