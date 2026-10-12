r"""The app icon and the page icon from the Nazeer logo (D11).

    engine\.venv\Scripts\python.exe -I app\scripts\make_icon.py

Reads ``app\build\logo.png`` (the operator's logo, kept exactly as given) and writes
``app\build\icon.ico`` (16-256 px: the executable, the installer, the uninstaller and the window)
and ``app\src\renderer\favicon.png`` (the page icon: the logo as given). Sizes up to the logo's own
are its pixels scaled down; larger ones (Windows wants 256 px) are smooth enlargements, softer than
the rest until a bigger master (256 px or more, or vector) exists.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image

APP_DIR = Path(__file__).resolve().parents[1]
LOGO = APP_DIR / "build" / "logo.png"
ICON = APP_DIR / "build" / "icon.ico"
FAVICON = APP_DIR / "src" / "renderer" / "favicon.png"
ICO_SIZES = (256, 128, 64, 48, 32, 24, 16)


def icon_frames(logo: Image.Image) -> list[Image.Image]:
    """One frame per size, largest first; the logo's own size is kept pixel for pixel."""
    frames = []
    for size in ICO_SIZES:
        if size == logo.width:
            frames.append(logo.copy())
        else:
            frames.append(logo.resize((size, size), Image.Resampling.LANCZOS))
    return frames


def main() -> int:
    logo = Image.open(LOGO).convert("RGBA")
    if logo.width != logo.height:
        print(f"{LOGO} is {logo.width}x{logo.height}: the logo must be square", file=sys.stderr)
        return 2
    frames = icon_frames(logo)
    frames[0].save(ICON, format="ICO", sizes=[f.size for f in frames], append_images=frames[1:])
    shutil.copyfile(LOGO, FAVICON)
    enlarged = [s for s in ICO_SIZES if s > logo.width]
    print(f"logo {logo.width} px -> {ICON} ({', '.join(map(str, ICO_SIZES))} px) and {FAVICON}")
    if enlarged:
        print(f"enlarged from {logo.width} px (softer): {', '.join(map(str, enlarged))} px")
    return 0


if __name__ == "__main__":
    sys.exit(main())
