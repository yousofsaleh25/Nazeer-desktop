"""Nazeer Desktop measurement engine.

Importing this package must stay cheap: no torch, cv2, pyrealsense2 or matplotlib at
import time. Heavy libraries are imported lazily inside the modules that need them.
"""

from __future__ import annotations

__version__ = "0.1.0"
