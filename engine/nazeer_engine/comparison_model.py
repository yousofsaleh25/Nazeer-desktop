"""The comparison model (D12 F2.1, F2.4-F2.7): eligibility, staleness, rows and cells.

Pure functions, no I/O. A comparison is built from each member's **frozen** report model
(``report_model_vN.json``, model 1.1: the texts the single report prints), never from a
recomputation, so a cell shows exactly what that camel's own report shows. The engine matches
the rows; the print page only lays them out.

Nothing ranks (D12 F2.4): members keep the operator's order, rows follow first appearance
across that order, and the model carries **texts only** — no value, difference, percentage or
total. Rows match by (exact stored name, computed kind, occurrence): a 2D and a 3D measurement
never share a row, case / spacing / harakat differences make separate rows, an unnamed
measurement never matches another camel's, and the k-th "Height" of one camel pairs with the
k-th "Height" of the next (Q4, recorded in ``disambiguated``). Reasons travel under a
``"reason"`` key, never ``"code"`` (the app's error-code sweep reads ``"code"``).
"""

from __future__ import annotations

import copy
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from . import labels, report_content
from .constants import COMPARISON_MODEL_VERSION, COMPARISON_REPORT_MODELS, ENGINE_VERSION
from .errors import CorruptFileError

Label = dict[str, str]

# F2.1: why a History row cannot join a comparison, in the order they are checked
INELIGIBLE_REASONS: tuple[str, ...] = (
    "delete_failed",
    "files_missing",
    "file_corrupt",
    "files_changed",  # only when a comparison is created: re-checked from the files
    "not_finalized",
    "reopened",
    "model_outdated",
)
# F2.7 (Q2: by content): a member that no longer shows what the comparison shows
STALE_REASONS: tuple[str, ...] = (
    "member_deleted",
    "member_unreadable",
    "member_reopened",
    "member_edited",
    "member_refinalized",
)
STALE_NOTES: tuple[str, ...] = ("member_session_changed",)  # recorded, never stale by itself
COMPARISON_STATUSES: tuple[str, ...] = ("created", "sealed")
COVER_KEYS: tuple[str, ...] = ("title", "event", "judge", "council")
KINDS_2D = frozenset(
    {"distance_2d", "curve_2d", "angle_2d_4point", "angle_2d_3point", "angle_2d_from_horizontal"}
)
SEALED_STATUSES: tuple[str, ...] = ("finalized", "exported")


def _same(text: str) -> Label:
    return {"ar": text, "en": text}


# ----- eligibility and approval (from a History index row or a session's files) ------------


def ineligible_reason(row: Mapping[str, Any]) -> str | None:
    """``None`` when the session can join a comparison, else the first reason that keeps it
    out (F2.1). ``row`` is a History index row (or the same fields read from the files)."""
    state = row.get("index_state") or "ok"
    if state == "delete_failed":
        return "delete_failed"
    if state == "missing_files":
        return "files_missing"
    if state == "corrupt":
        return "file_corrupt"
    if row.get("status") not in SEALED_STATUSES or not row.get("overlay_version"):
        return "reopened" if row.get("outputs_stale") else "not_finalized"
    if row.get("outputs_stale"):
        return "reopened"
    schema = row.get("report_model_schema")
    if not schema:  # finalized, but its report model file is missing or unreadable
        return "files_missing"
    if schema not in COMPARISON_REPORT_MODELS:
        return "model_outdated"
    return None


def approved_by_seal(row: Mapping[str, Any]) -> bool:
    """A report sealed from the session's current image (F2.2 / Q1): the only durable proof
    that the operator approved that image (the ``--export`` guard's clauses, every one)."""
    overlay = int(row.get("overlay_version") or 0)
    return (
        row.get("status") in SEALED_STATUSES
        and not row.get("outputs_stale")
        and int(row.get("report_version") or 0) > 0
        and overlay > 0
        and int(row.get("report_overlay_version") or 0) == overlay
    )


# ----- staleness (F2.7, Q2) --------------------------------------------------------------------


def stale_reasons(snapshot: Mapping[str, Any], current: Mapping[str, Any] | None) -> list[str]:
    """Why member ``snapshot`` (taken at creation) no longer matches ``current``.

    ``current`` is the session's index row or the same fields read from its files
    (``index_state``, ``status``, ``outputs_stale``, ``revision``, ``input_sha256``,
    ``overlay_version``, ``overlay_sha256``); ``None`` = the session is gone. Only content
    counts: a re-sealed report or changed report details (``session.json`` rewritten, the
    measurements untouched) are not stale."""
    if current is None or current.get("index_state") == "missing_files":
        return ["member_deleted"]
    if current.get("index_state") == "corrupt":
        return ["member_unreadable"]
    reasons: list[str] = []
    if current.get("status") not in SEALED_STATUSES or current.get("outputs_stale"):
        reasons.append("member_reopened")
    if int(current.get("revision") or 0) != int(snapshot.get("revision") or 0) or _changed(
        current, snapshot, "input_sha256"
    ):
        reasons.append("member_edited")
    if int(current.get("overlay_version") or 0) != int(
        snapshot.get("overlay_version") or 0
    ) or _changed(current, snapshot, "overlay_sha256"):
        reasons.append("member_refinalized")
    return reasons


def _changed(current: Mapping[str, Any], snapshot: Mapping[str, Any], key: str) -> bool:
    """An empty current hash is unknown, not changed: an index row the version-2 migration has
    not refreshed yet (its session was busy at the first list); the files always carry it, and
    the revision and versions are still compared."""
    now = current.get(key) or ""
    return now != "" and now != (snapshot.get(key) or "")


# ----- the member block, from a frozen report model -----------------------------------------


def _pair(value: Any, where: str) -> Label:
    if not isinstance(value, Mapping) or not isinstance(value.get("ar"), str):
        raise CorruptFileError(f"report model: {where} is not a bilingual text")
    return {"ar": value["ar"], "en": str(value.get("en") or "")}


def _optional_pair(value: Any, where: str) -> Label | None:
    if value is None:
        return None
    pair = _pair(value, where)
    return pair if (pair["ar"] or pair["en"]) else None


def depth_note(kind: str, n_points: Any, n_points_knn: Any) -> Label | None:
    """The note "k of n points snapped to the camel (KNN)" for a 3D row with snapped points
    (F2.5): the honesty contract shows every fallback, and a snap under 10 cm has no flag chip."""
    if kind in KINDS_2D or not isinstance(n_points_knn, int) or n_points_knn <= 0:
        return None
    return labels.snapped_summary(n_points_knn, int(n_points or 0))


def member_rows(report_model: Mapping[str, Any]) -> list[dict[str, Any]]:
    """One camel's measurement rows as texts (the per-camel section of the PDF)."""
    raw = report_model.get("measurements")
    if not isinstance(raw, list):
        raise CorruptFileError("report model: measurements is not a list")
    rows: list[dict[str, Any]] = []
    for i, r in enumerate(raw):
        where = f"measurements[{i}]"
        if not isinstance(r, Mapping) or not isinstance(r.get("id"), int):
            raise CorruptFileError(f"report model: {where} has no id")
        kind = str(r.get("kind") or "")
        rejected = bool(r.get("rejected"))
        confidence = r.get("confidence_label")
        detail = None
        if isinstance(r.get("curve"), Mapping):
            detail = _optional_pair(r["curve"].get("cross_check_text"), f"{where}.curve")
        elif isinstance(r.get("lines"), Mapping):
            detail = _optional_pair(r["lines"].get("text"), f"{where}.lines")
        rows.append(
            {
                "measurement_id": r["id"],
                "name": str(r.get("name") or ""),
                "kind": kind,
                "kind_label": _pair(r.get("kind_label"), f"{where}.kind_label"),
                "color": str(r.get("display_color") or ""),
                "note": str(r.get("note") or ""),
                "value_text": None if rejected else _pair(r.get("value_text"), where),
                "uncertainty_text": None
                if rejected
                else _optional_pair(r.get("uncertainty_text"), where),
                "depth_basis": [
                    {"point": b.get("point"), **_pair(b, f"{where}.depth_basis")}
                    for b in (r.get("depth_basis") or [])
                ],
                "depth_note": depth_note(kind, r.get("n_points"), r.get("n_points_knn")),
                "flags": [dict(f) for f in (r.get("flags") or []) if isinstance(f, Mapping)],
                "confidence": (
                    dict(confidence)
                    if isinstance(confidence, Mapping) and confidence.get("code") != "high"
                    else None
                ),
                "rejected": rejected,
                "rejection": [
                    dict(p) for p in (r.get("rejection") or []) if isinstance(p, Mapping)
                ],
                "detail": detail,
            }
        )
    return rows


def member_block(
    position: int,
    *,
    session: Mapping[str, Any],
    report_model: Mapping[str, Any],
    report_model_ref: Mapping[str, Any],
    overlay: Mapping[str, Any],
    session_json_sha256: str,
    input_sha256: str,
) -> dict[str, Any]:
    """Member ``position`` (1-based, the operator's order) as the comparison model holds it.

    ``session``: the current ``session_id``, ``camel_id``, ``operator``, ``status``,
    ``revision``, ``created_at``; ``report_model``: the parsed frozen model whose file is
    ``report_model_ref`` (``file``, ``version``, ``sha256``); ``overlay``: its approved image
    (``file``, ``version``, ``sha256``, ``width``, ``height``)."""
    frame = report_model.get("frame")
    summary = report_model.get("summary")
    if not isinstance(frame, Mapping) or not isinstance(summary, Mapping):
        raise CorruptFileError("report model: frame or summary missing")
    texts = frame.get("texts")
    if not isinstance(texts, Mapping):
        raise CorruptFileError("report model: frame.texts missing (a 1.0 model?)")
    camel_id = str(session.get("camel_id") or "")
    session_id = str(session["session_id"])
    status = str(session.get("status") or "")
    revision = int(session.get("revision") or 0)
    bag_name = frame.get("bag_name")
    source = _pair(texts.get("source"), "frame.texts.source")
    model_engine = str(report_model.get("engine_version") or "--")
    model_generated = str(report_model.get("generated_at") or "--")
    return {
        "position": position,
        "session_id": session_id,
        "camel_id": camel_id,
        "operator": str(session.get("operator") or ""),
        "status": status,
        "revision": revision,
        "created_at": str(session.get("created_at") or ""),
        "bag": {"name": bag_name, "read_index": frame.get("read_index")},
        "overlay": {
            key: overlay.get(key) for key in ("file", "version", "sha256", "width", "height")
        },
        "report_model": {
            "file": report_model_ref.get("file"),
            "version": report_model_ref.get("version"),
            "sha256": report_model_ref.get("sha256"),
            "report_model_version": report_model.get("report_model_version"),
            "engine_version": model_engine,
            "generated_at": model_generated,
        },
        "session_json_sha256": session_json_sha256,
        "input_sha256": input_sha256,
        "frame": {
            "texts": {
                "z_ref": _pair(texts.get("z_ref"), "frame.texts.z_ref"),
                "ground": _pair(texts.get("ground"), "frame.texts.ground"),
                "source": source,
            }
        },
        "rows": member_rows(report_model),
        "summary": {
            "snapped_text": _pair(summary.get("snapped_text"), "summary.snapped_text"),
            "counts_text": _pair(summary.get("counts_text"), "summary.counts_text"),
        },
        "texts": {
            "column": _same(f"#{position} · {camel_id}" if camel_id else f"#{position}"),
            "heading": {
                "ar": f"الجمل #{position}: {camel_id}",
                "en": f"Camel #{position}: {camel_id}",
            },
            "status": labels.label(labels.STATUS_LABELS, status),
            "source": {
                "ar": f"{bag_name or '--'} · {source['ar']}",
                "en": f"{bag_name or '--'} · {source['en']}",
            },
            "provenance": {
                "overlay": _same(
                    f"{overlay.get('file')} · v{overlay.get('version')} · "
                    f"sha256 {overlay.get('sha256')}"
                ),
                "report_model": _same(
                    f"{report_model_ref.get('file')} · sha256 {report_model_ref.get('sha256')} · "
                    f"{model_engine} · {model_generated}"
                ),
                "session": {
                    "ar": f"{session_id} · رقم المراجعة {revision}",
                    "en": f"{session_id} · revision {revision}",
                },
            },
        },
    }


# ----- rows across members (F2.5) --------------------------------------------------------------


def _cell(row: Mapping[str, Any], occurrence: int, n_in_session: int) -> dict[str, Any]:
    return {
        "measurement_id": row["measurement_id"],
        "value_text": row["value_text"],
        "uncertainty_text": row["uncertainty_text"],
        "depth_note": row["depth_note"],
        "flags": row["flags"],
        "confidence": row["confidence"],
        "rejected": row["rejected"],
        "rejection": row["rejection"],
        "occurrence": occurrence,
        "n_in_session": n_in_session,
    }


def build_rows(members: Sequence[Mapping[str, Any]]) -> tuple[list[dict], list[dict]]:
    """The comparison table: (rows, disambiguated). ``cells[i]`` belongs to ``members[i]``;
    ``None`` = that camel has no such measurement (printed as the static "—")."""
    order: list[tuple] = []
    table: dict[tuple, dict[str, Any]] = {}
    totals: dict[tuple[str, str], list[int]] = {}
    n_members = len(members)
    for index, member in enumerate(members):
        rows = member["rows"]
        counts = Counter((r["name"], r["kind"]) for r in rows if r["name"])
        for (name, kind), n in counts.items():
            totals.setdefault((name, kind), [0] * n_members)[index] = n
        seen: Counter[tuple[str, str]] = Counter()
        for r in rows:
            if r["name"]:
                seen[(r["name"], r["kind"])] += 1
                occurrence = seen[(r["name"], r["kind"])]
                key: tuple = ("named", r["name"], r["kind"], occurrence)
                n_in_session = counts[(r["name"], r["kind"])]
            else:  # an unnamed measurement never matches across camels
                key = ("unnamed", member["position"], r["measurement_id"])
                occurrence, n_in_session = 1, 1
            entry = table.get(key)
            if entry is None:
                entry = {
                    "name": r["name"],
                    "kind": r["kind"],
                    "kind_label": r["kind_label"],
                    "occurrence": occurrence,
                    "unnamed": not r["name"],
                    "cells": [None] * n_members,
                }
                table[key] = entry
                order.append(key)
            entry["cells"][index] = _cell(r, occurrence, n_in_session)
    out: list[dict[str, Any]] = []
    for row_id, key in enumerate(order, start=1):
        entry = table[key]
        if entry["unnamed"]:
            n_occ = 1
            owner = next(c for c in entry["cells"] if c is not None)
            name_text = {
                "ar": f"{report_content.UNNAMED['ar']} #{owner['measurement_id']}",
                "en": f"{report_content.UNNAMED['en']} #{owner['measurement_id']}",
            }
        else:
            n_occ = max(totals[(entry["name"], entry["kind"])])
            name_text = _same(entry["name"])
        occurrence_text = _same(f"({entry['occurrence']}/{n_occ})") if n_occ > 1 else None
        out.append(
            {
                "row_id": row_id,
                "name": entry["name"],
                "name_text": name_text,
                "unnamed": entry["unnamed"],
                "kind": entry["kind"],
                "kind_label": entry["kind_label"],
                "occurrence": entry["occurrence"],
                "n_occurrences": n_occ,
                "occurrence_text": occurrence_text,
                "cells": entry["cells"],
            }
        )
    disambiguated = [
        {
            "name": name,
            "kind": kind,
            "pairing": "by_order",
            "counts": [
                {"position": members[i]["position"], "n": n} for i, n in enumerate(per_member)
            ],
        }
        for (name, kind), per_member in totals.items()
        if max(per_member) > 1
    ]
    return out, disambiguated


# ----- the model ---------------------------------------------------------------------------------


def cover_block(cover: Mapping[str, str]) -> dict[str, Any]:
    """The operator's cover texts plus the title to print (an engine default when empty)."""
    values = {key: str(cover.get(key) or "") for key in COVER_KEYS}
    title = values["title"].strip()
    return {
        **values,
        "title_text": _same(values["title"]) if title else dict(report_content.COMPARISON_TITLE),
    }


def signature_wells(cover: Mapping[str, str]) -> list[dict[str, str]]:
    return [
        {**well, "name": str(cover.get("judge" if well["id"] == "judge" else "council") or "")}
        for well in report_content.SIGNATURE_WELLS
    ]


def build_model(
    *,
    comparison_id: str,
    version: int,
    language: str,
    cover: Mapping[str, str],
    members: Sequence[Mapping[str, Any]],
    created_at: str,
    generated_at: str,
    versions: Mapping[str, Any],
    constants: Mapping[str, Any],
) -> dict[str, Any]:
    rows, disambiguated = build_rows(members)
    return {
        "comparison_model_version": COMPARISON_MODEL_VERSION,
        "version": version,
        "engine_version": ENGINE_VERSION,
        "generated_at": generated_at,
        "comparison_id": comparison_id,
        "created_at": created_at,
        "language": language,
        "cover": cover_block(cover),
        "members": [dict(m) for m in members],
        "rows": rows,
        "disambiguated": disambiguated,
        "signature_wells": signature_wells(cover),
        "static": report_content.comparison_static(),
        "versions": dict(versions),
        "constants": dict(constants),
    }


def revise_model(
    previous: Mapping[str, Any],
    *,
    version: int,
    language: str,
    cover: Mapping[str, str],
    generated_at: str,
    versions: Mapping[str, Any],
) -> dict[str, Any]:
    """Model v+1 after a cover or language change: members and rows are copied from the
    previous version (no member file is read, F2.6), only the operator's texts change."""
    model = copy.deepcopy(dict(previous))
    model.update(
        {
            "version": version,
            "generated_at": generated_at,
            "language": language,
            "cover": cover_block(cover),
            "signature_wells": signature_wells(cover),
            "versions": dict(versions),
        }
    )
    return model


def required_texts(model: Mapping[str, Any]) -> list[str]:
    """The operator-entered strings the PDF text probe requires (F2.9): every member's
    measurement names and camel id, and the cover's title, event, judge and council."""
    texts: list[str] = []
    for member in model.get("members") or []:
        texts.extend(member_texts(member))
    cover = model.get("cover") or {}
    texts.extend(str(cover.get(key) or "") for key in COVER_KEYS)
    return _unique(t for t in texts if t)


def member_texts(member: Mapping[str, Any]) -> list[str]:
    """One member's names and camel id (each must appear within that camel's own pages)."""
    texts = [str(r.get("name") or "") for r in member.get("rows") or []]
    texts.append(str(member.get("camel_id") or ""))
    return _unique(t for t in texts if t)


def _unique(items: Any) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out
