"""The overlay PNG: the single rendering authority for the measured frame (ADR-D7, B12).

Rendered once per finalize with matplotlib's object API (``Figure`` + ``FigureCanvasAgg``,
never pyplot global state) at a fixed size: the frame at 1:1 pixels plus a footer band
below it (1280 x 840 for a 720p frame), so the print page can place it at a known size
and the PDF probe can compare pixels exactly.

What is drawn (C1.6 / C1.7): the mask outline, the near-plane ground line (and the raw
far-leg row when they differ), every measurement in operator order with its colour —
direct points as filled markers, KNN points as hollow markers with a dotted leader to the
neighbour centroid, rejected rows grey and dashed, flagged 3D-curve segments in red,
angle arcs — and a footer with "N of M points snapped", the Z_ref block and the session
stamp. Labels use the operator-approved style vendored from the parent overlay.
"""

from __future__ import annotations

import io
import math
import threading
from datetime import UTC, datetime
from typing import Any

import numpy as np

from .arabic import (
    display_text,
    ensure_arabic_stack,
    font_properties,
    isolate,
    ltr,
    matplotlib_missing,
)
from .constants import ENGINE_VERSION, FONT_FILE, OVERLAY_DPI, OVERLAY_FOOTER_PX
from .session_compute import present_rows, summarize
from .session_schema import SessionDocument

_RENDER_LOCK = threading.Lock()
GROUND_COLOR = "#FF3333"
REJECTED_COLOR = "#9E9E9E"
JUMP_COLOR = "#FF3333"
DEFAULT_COLOR = "#D97757"
LABEL_TEXT_COLOR = "#1A1A1A"
LABEL_OFFSET_PX = 14.0
ARC_RADIUS_PX = 38.0
ARC_LABEL_OFFSET_PX = 18.0
GROUND_PAD_PX = 40
SHORT_FLAGS: dict[str, str] = {
    "knn_far": "far",
    "knn_spread": "spread",
    "depth_edge": "edge",
    "off_mask_surface": "surface",
    "ground_target_unresolved": "no ground depth",
    "knn_raw_boundary": "boundary",
    "segment_depth_jump": "depth jump",
    "endpoint_dz": "off-plane",
}


def _label_style(edge: str) -> dict[str, Any]:
    import matplotlib.patheffects as pe

    return {
        "color": LABEL_TEXT_COLOR,
        "fontsize": 9,
        "fontweight": "semibold",
        "bbox": {
            "boxstyle": "round,pad=0.28",
            "facecolor": "white",
            "edgecolor": edge,
            "linewidth": 1.4,
            "alpha": 0.50,
        },
        "path_effects": [pe.withStroke(linewidth=2.4, foreground="white", alpha=0.95), pe.Normal()],
        "zorder": 20,
        "clip_on": False,
    }


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def _label_text(row: dict[str, Any]) -> str:
    """``<name>:  <value> ± <u>  [chips]`` as a left-to-right paragraph (B36)."""
    name = isolate(row.get("name") or f"#{row['id']}")
    pres = row["presentation"]
    if pres["rejected"]:
        first = pres["rejection"][0]["en"] if pres["rejection"] else row["rejection_reason"]
        return ltr(f"{name}:  rejected ({first})")
    text = f"{name}:  {pres['value_text']['en']}"
    if pres["uncertainty_text"]["en"]:
        text += f" {pres['uncertainty_text']['en']}"
    chips: list[str] = []
    if pres.get("n_points_knn"):
        chips.append(f"KNN {pres['n_points_knn']}")
    for chip in pres["flags"]:
        short = SHORT_FLAGS.get(chip["code"])
        if short and chip["severity"] == "warn" and short not in chips:
            chips.append(short)
    if chips:
        text += "  [" + ", ".join(chips) + "]"
    return ltr(text)


def _overlaps(a: Any, b: Any, pad: float) -> bool:
    return not (
        a.x1 + pad <= b.x0 or b.x1 + pad <= a.x0 or a.y1 + pad <= b.y0 or b.y1 + pad <= a.y0
    )


class _Painter:
    def __init__(self, ax: Any, fp: Any, width: int, height: int) -> None:
        self.ax = ax
        self.fp = fp
        self.w = width
        self.h = height
        self.pending: list[tuple[float, float, str, str]] = []

    def label(self, x: float, y: float, text: str, edge: str) -> None:
        """Queue a label; ``place_labels`` lays them out without overlaps."""
        self.pending.append(
            (_clamp(x, 6.0, self.w - 6.0), _clamp(y, 10.0, self.h - 10.0), text, edge)
        )

    def place_labels(self, renderer: Any) -> int:
        """Greedy de-overlap: each label tries its anchor, then steps of one label height
        up/down (up to 4), keeping the first free slot. Returns the number moved."""
        placed: list[Any] = []
        moved = 0
        for x, y, text, edge in self.pending:
            artist = self.ax.text(
                x, y, text, fontproperties=self.fp, ha="center", va="center", **_label_style(edge)
            )
            box = artist.get_window_extent(renderer)
            step_px = box.height + 8.0
            best = box
            if any(_overlaps(box, other, 4.0) for other in placed):
                for k in (1, -1, 2, -2, 3, -3, 4, -4):
                    # display y grows upwards; data y grows downwards (inverted axis)
                    candidate_y = _clamp(y - k * step_px, 10.0, self.h - 10.0)
                    artist.set_y(candidate_y)
                    trial = artist.get_window_extent(renderer)
                    if not any(_overlaps(trial, other, 4.0) for other in placed):
                        best = trial
                        moved += 1
                        break
                else:
                    artist.set_y(y)
                    best = box
            placed.append(best)
        return moved

    def marker(
        self, point: Any, prov: dict[str, Any] | None, color: str, *, use_provenance: bool
    ) -> None:
        u, v = float(point[0]), float(point[1])
        if use_provenance and prov is not None:
            if prov.get("reason"):
                self.ax.plot(u, v, marker="x", ms=7, mec=REJECTED_COLOR, mew=2, zorder=12)
                return
            source = str(prov.get("source") or "")
            if source.startswith("knn_"):
                centroid = prov.get("nn_centroid_px")
                if centroid is not None:
                    cu, cv = float(centroid[0]), float(centroid[1])
                    self.ax.plot([u, cu], [v, cv], color=color, lw=1, ls=":", alpha=0.9, zorder=11)
                    self.ax.plot(cu, cv, marker=".", ms=3, color=color, zorder=11)
                self.ax.plot(u, v, marker="o", ms=7, mfc="none", mec=color, mew=1.6, zorder=12)
                return
        self.ax.plot(u, v, marker="o", ms=5, mfc=color, mec="white", mew=0.8, zorder=12)

    def arc(self, vertex: Any, a: Any, b: Any, color: str, *, radius: float) -> float:
        """Arc at ``vertex`` between the rays to ``a`` and ``b``; returns the bisector angle."""
        from matplotlib.patches import Arc

        vx, vy = float(vertex[0]), float(vertex[1])
        ta = math.degrees(math.atan2(float(a[1]) - vy, float(a[0]) - vx))
        tb = math.degrees(math.atan2(float(b[1]) - vy, float(b[0]) - vx))
        sweep = (tb - ta) % 360.0
        t1, t2 = (ta, tb) if sweep <= 180.0 else (tb, ta)
        span = (t2 - t1) % 360.0
        self.ax.add_patch(
            Arc(
                (vx, vy), 2 * radius, 2 * radius, theta1=t1, theta2=t2, color=color, lw=2, zorder=10
            )
        )
        return math.radians(t1 + span / 2.0)


def _line_label_anchor(p1: Any, p2: Any) -> tuple[float, float]:
    x1, y1, x2, y2 = float(p1[0]), float(p1[1]), float(p2[0]), float(p2[1])
    mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    if norm < 1e-9:
        return mx, my - LABEL_OFFSET_PX
    px, py = -dy / norm, dx / norm
    if py > 0:  # keep the label above the line (image y grows downwards)
        px, py = -px, -py
    return mx + px * LABEL_OFFSET_PX, my + py * LABEL_OFFSET_PX


def render_overlay_png(
    bgr: np.ndarray,
    doc: SessionDocument,
    *,
    mask: np.ndarray | None = None,
    rendered_at: str | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """Render the overlay; returns ``(png_bytes, meta)``. Raises ``ArabicStackMissing``."""
    # the stack first: a matplotlib that cannot load is a typed arabic_stack_missing, never an
    # untyped ImportError (also when the stack was checked as ok earlier in this process)
    state = ensure_arabic_stack()
    try:
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        fp = font_properties()
    except ImportError as exc:
        raise matplotlib_missing(f"{type(exc).__name__}: {exc}") from exc
    rendered_at = rendered_at or datetime.now(UTC).replace(microsecond=0).isoformat()
    h, w = int(bgr.shape[0]), int(bgr.shape[1])
    footer = OVERLAY_FOOTER_PX
    total_h = h + footer
    rows = present_rows(doc)
    summary = summarize(doc)
    meta = doc.frame_metadata
    z_block = meta.get("z_ref") or {}
    z_ref = z_block.get("z_ref_m")
    ground = meta.get("ground") or {}
    lines_by_id = {r["id"]: r for r in rows if r["family"] == "lines"}

    with _RENDER_LOCK:
        fig = Figure(
            figsize=(w / OVERLAY_DPI, total_h / OVERLAY_DPI), dpi=OVERLAY_DPI, facecolor="white"
        )
        canvas = FigureCanvasAgg(fig)
        ax = fig.add_axes((0.0, footer / total_h, 1.0, h / total_h))
        rgb = np.ascontiguousarray(bgr[..., ::-1])
        ax.imshow(rgb, interpolation="nearest", extent=(-0.5, w - 0.5, h - 0.5, -0.5))
        ax.set_xlim(-0.5, w - 0.5)
        ax.set_ylim(h - 0.5, -0.5)
        ax.set_axis_off()
        paint = _Painter(ax, fp, w, h)

        if mask is not None and (mask != 0).any():
            import cv2

            contours, _ = cv2.findContours(
                (mask != 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            for contour in contours:
                pts = contour[:, 0, :].astype(float)
                if len(pts) < 2:
                    continue
                closed = np.vstack([pts, pts[:1]])
                ax.plot(closed[:, 0], closed[:, 1], color="white", lw=1, alpha=0.6, zorder=5)

        drawn_row = ground.get("drawn_row")
        if drawn_row is not None and ground.get("x_min") is not None:
            x0 = max(0, int(ground["x_min"]) - GROUND_PAD_PX)
            x1 = min(w - 1, int(ground["x_max"]) + GROUND_PAD_PX)
            ax.plot([x0, x1], [drawn_row, drawn_row], color=GROUND_COLOR, lw=2, zorder=8)
            z_text = f"{z_ref:.3f} m" if z_ref is not None else "?"
            ax.text(
                x0 + 4,
                max(10, drawn_row - 8),
                ltr(f"{isolate('مرجع الأرض')}  ground ref  (Z_ref = {z_text})"),
                fontproperties=fp,
                fontsize=10,
                color=GROUND_COLOR,
                zorder=9,
                path_effects=_label_style(GROUND_COLOR)["path_effects"],
            )
            raw = ground.get("raw_row")
            if ground.get("badge") == "far_side_row_differs" and raw is not None:
                ax.plot(
                    [x0, x1], [raw, raw], color=GROUND_COLOR, lw=1, ls="--", alpha=0.7, zorder=8
                )
                ax.text(
                    x1 - 4,
                    min(h - 10, raw + 10),
                    ltr(f"{isolate('صف الساق البعيدة')}  far-leg row"),
                    fontproperties=fp,
                    fontsize=8,
                    color=GROUND_COLOR,
                    ha="right",
                    zorder=9,
                )

        for row in rows:
            rejected = bool(row["rejection_reason"])
            color = row.get("display_color") or DEFAULT_COLOR
            draw = REJECTED_COLOR if rejected else color
            ls = "--" if rejected else "-"
            kind = row["kind"]
            text = _label_text(row)
            if row["family"] == "lines":
                p1, p2 = row["p1_px"], row["p2_px"]
                ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=draw, lw=2, ls=ls, zorder=9)
                use_prov = kind == "distance_3d"
                paint.marker(p1, row.get("p1_depth"), draw, use_provenance=use_prov)
                paint.marker(p2, row.get("p2_depth"), draw, use_provenance=use_prov)
                lx, ly = _line_label_anchor(p1, p2)
                paint.label(lx, ly, text, draw)
            elif row["family"] == "curves":
                pts = row["points_px"]
                if len(pts) >= 2:
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    ax.plot(xs, ys, color=draw, lw=2, ls=ls, zorder=9)
                    for i, flags in enumerate(row.get("segment_flags") or []):
                        if flags and i + 1 < len(pts):
                            ax.plot(
                                [pts[i][0], pts[i + 1][0]],
                                [pts[i][1], pts[i + 1][1]],
                                color=JUMP_COLOR,
                                lw=3.5,
                                zorder=10,
                            )
                provs = row.get("point_depth") or []
                use_prov = kind == "curve_3d"
                for i, p in enumerate(pts):
                    paint.marker(
                        p, provs[i] if i < len(provs) else None, draw, use_provenance=use_prov
                    )
                if pts:
                    mid = pts[len(pts) // 2]
                    paint.label(float(mid[0]), float(mid[1]) - LABEL_OFFSET_PX - 4, text, draw)
            elif kind in ("angle_2d_3point", "angle_3d_3point"):
                v, a, b = row["vertex_px"], row["endpoint_a_px"], row["endpoint_b_px"]
                ax.plot([v[0], a[0]], [v[1], a[1]], color=draw, lw=2, ls=ls, zorder=9)
                ax.plot([v[0], b[0]], [v[1], b[1]], color=draw, lw=2, ls=ls, zorder=9)
                use_prov = kind == "angle_3d_3point"
                for p, prov in (
                    (v, row.get("vertex_depth")),
                    (a, row.get("endpoint_a_depth")),
                    (b, row.get("endpoint_b_depth")),
                ):
                    paint.marker(p, prov, draw, use_provenance=use_prov)
                ray = min(math.dist(v, a), math.dist(v, b))
                radius = max(6.0, min(ARC_RADIUS_PX, 0.35 * ray))
                bisector = paint.arc(v, a, b, draw, radius=radius)
                reach = radius + ARC_LABEL_OFFSET_PX
                paint.label(
                    v[0] + reach * math.cos(bisector), v[1] + reach * math.sin(bisector), text, draw
                )
            elif kind == "angle_2d_from_horizontal":
                p1, p2 = row["endpoint_a_px"], row["endpoint_b_px"]
                ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=draw, lw=2, ls="--", zorder=9)
                direction = 1.0 if p2[0] >= p1[0] else -1.0
                ref = (p1[0] + direction * 40.0, p1[1])
                ax.plot([p1[0], ref[0]], [p1[1], ref[1]], color=draw, lw=1, ls=":", zorder=9)
                paint.marker(p1, None, draw, use_provenance=False)
                paint.marker(p2, None, draw, use_provenance=False)
                if math.dist(p1, p2) > 1e-6:
                    radius = max(6.0, min(ARC_RADIUS_PX, 0.35 * math.dist(p1, p2)))
                    paint.arc(p1, ref, p2, draw, radius=radius)
                lx, ly = _line_label_anchor(p1, p2)
                paint.label(lx, ly, text, draw)
            else:  # 4-point angle: label between the two referenced lines
                la = lines_by_id.get(row.get("line_a_id"))
                lb = lines_by_id.get(row.get("line_b_id"))
                if la is None or lb is None:
                    continue
                pts = [la["p1_px"], la["p2_px"], lb["p1_px"], lb["p2_px"]]
                cx = sum(float(p[0]) for p in pts) / 4.0
                cy = sum(float(p[1]) for p in pts) / 4.0
                paint.label(cx, cy, text, draw)

        fax = fig.add_axes((0.0, 0.0, 1.0, footer / total_h))
        fax.set_axis_off()
        fax.set_xlim(0.0, 1.0)
        fax.set_ylim(0.0, 1.0)
        snapped = summary["snapped_text"]
        n_valid = z_block.get("n_valid")
        erosion = z_block.get("erosion_px")
        ground_text = (
            f"ground row {drawn_row}" if drawn_row is not None else "ground row unresolved"
        )
        if ground.get("badge") == "far_side_row_differs":
            ground_text += f" (far-leg row {ground.get('raw_row')})"
        z_text = f"{z_ref:.3f} m" if z_ref is not None else "?"
        line1 = (
            f"{snapped['en']}  ·  Z_ref {z_text} (median of {n_valid} px, mask eroded {erosion} px)"
            f"  ·  {ground_text}"
        )
        line2 = display_text(snapped["ar"])  # a pure Arabic sentence: its own RTL paragraph
        model = (meta.get("model") or {}).get("sha256") or ""
        camel = isolate(doc.camel_id) if doc.camel_id else "—"
        line3 = ltr(
            f"session {doc.session_id}  ·  camel {camel}  ·  model {model[:12]}  ·  "
            f"engine {ENGINE_VERSION}  ·  {rendered_at}"
        )
        for y, text, size in ((0.76, line1, 10), (0.46, line2, 10), (0.16, line3, 9)):
            fax.text(0.01, y, text, fontproperties=fp, fontsize=size, color="#2A1F18", va="center")

        labels_moved = paint.place_labels(canvas.get_renderer())
        buffer = io.BytesIO()
        canvas.print_png(buffer, metadata={"Software": None})
        fig.clear()
    png = buffer.getvalue()
    out_meta = {
        "width": w,
        "height": total_h,
        "frame_height": h,
        "footer_px": footer,
        "dpi": OVERLAY_DPI,
        "n_lines": sum(1 for r in rows if r["family"] == "lines"),
        "n_curves": sum(1 for r in rows if r["family"] == "curves"),
        "n_angles": sum(1 for r in rows if r["family"] == "angles"),
        "n_rejected": sum(1 for r in rows if r["rejection_reason"]),
        "n_points": summary["n_points"],
        "n_points_knn": summary["n_points_knn"],
        "font_file": FONT_FILE,
        "font_sha256": state["font_sha256"],
        "rendered_at": rendered_at,
        "ground_row": drawn_row,
        "labels_moved": labels_moved,
        "native_text_layout": bool(state.get("native")),
    }
    return png, out_meta
