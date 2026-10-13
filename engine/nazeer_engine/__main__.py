"""``python -m nazeer_engine`` — the sidecar the Electron app spawns.

Startup order: UTF-8 stdout (B25) → arguments → data root (C3.1) → offline environment
(B26) → logging → single-instance lock → model (sha256 + warm-up) → state (index
reconcile, housekeeping) → ``--check`` exits here → bind 127.0.0.1 → serve. Stdout carries
exactly one JSON line for the supervisor: ``{"event": "ready", "port": …}`` after the app
started, or ``{"event": "fatal", "code": …}`` before exiting. Logs go to stderr and to
``<data_root>/logs/engine.log``.

Exit codes: 0 ok · 1 unexpected · 2 bad arguments / data root · 3 model · 5 port · 6 locked.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_UNEXPECTED = 1
EXIT_ARGS = 2
EXIT_MODEL = 3
EXIT_PORT = 5
EXIT_LOCKED = 6
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def _emit(obj: dict[str, Any]) -> None:
    """One ASCII JSON line on stdout (safe for any console code page)."""
    line = json.dumps(obj, ensure_ascii=True, allow_nan=False, default=str) + "\n"
    sys.stdout.buffer.write(line.encode("ascii"))
    sys.stdout.buffer.flush()


def _fatal(code: str, message: str, exit_code: int, **details: Any) -> int:
    _emit({"event": "fatal", "code": code, "message": message, "details": details})
    return exit_code


class EngineLock:
    """``<data_root>/engine.lock``: one engine per data root (pid + process start time).

    The file is created with ``O_CREAT | O_EXCL``, so of two engines started together only
    one gets it; a lock whose process is gone (or whose pid was reused) is stale and is
    replaced once. Release and port updates touch the file only while it is still ours."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.owned = False
        self._create_time_self: float | None = None

    @staticmethod
    def _create_time(pid: int) -> float | None:
        try:
            import psutil

            return float(psutil.Process(pid).create_time())
        except Exception:
            return None

    def holder(self) -> dict[str, Any] | None:
        if not self.path.is_file():
            return None
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        pid = data.get("pid")
        if not isinstance(pid, int) or pid == os.getpid():
            return None
        created = self._create_time(pid)
        if created is None or abs(created - float(data.get("create_time") or 0.0)) > 1.0:
            return None  # stale lock: process gone or pid reused
        return data

    def _read(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def _age_s(self) -> float:
        try:
            return max(0.0, time.time() - self.path.stat().st_mtime)
        except OSError:
            return float("inf")

    def _mine(self) -> bool:
        data = self._read()
        return bool(data) and data.get("pid") == os.getpid()  # type: ignore[union-attr]

    def acquire(self) -> bool:
        self._create_time_self = self._create_time(os.getpid())
        record = {"pid": os.getpid(), "create_time": self._create_time_self, "port": None}
        for _attempt in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                if self.holder() is not None:
                    return False
                if self._read() is None and self._age_s() < 2.0:
                    return False  # another engine created it a moment ago and is writing it
                try:  # stale (process gone, pid reused, or unreadable): replace it once
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                except OSError:
                    return False
                continue
            record["updated_at"] = datetime.now(UTC).replace(microsecond=0).isoformat()
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(record))
            self.owned = True
            return True
        return False

    def _write(self, data: dict[str, Any]) -> None:
        data["updated_at"] = datetime.now(UTC).replace(microsecond=0).isoformat()
        tmp = self.path.with_name(f".tmp_{os.getpid()}_{self.path.name}")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, self.path)

    def set_port(self, port: int) -> None:
        data = self._read()
        if not self.owned or not data or data.get("pid") != os.getpid():
            return  # never overwrite another engine's lock
        data["port"] = port
        self._write(data)

    def release(self) -> None:
        if self.owned:
            if self._mine():
                try:
                    self.path.unlink()
                except OSError:
                    pass
            self.owned = False


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="nazeer_engine", description=__doc__.split("\n\n")[0])
    parser.add_argument("--data-root", help="absolute, writable folder (app.getPath('userData'))")
    parser.add_argument("--port", type=int, default=0, help="0 = pick a free port")
    parser.add_argument("--host", default="127.0.0.1", choices=LOOPBACK_HOSTS)
    parser.add_argument("--model", help="model weights (default engine/models/best.pt)")
    parser.add_argument("--token", help="shared secret required on every request but /health")
    parser.add_argument("--cors-origin", action="append", default=None, help="repeatable")
    parser.add_argument("--allow-null-origin", action="store_true", help="file:// renderers")
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--no-warmup", action="store_true")
    parser.add_argument("--allow-any-data-root", action="store_true")
    parser.add_argument("--check", action="store_true", help="validate, print the ready line, exit")
    parser.add_argument("--dump-openapi", metavar="PATH", help="write openapi.json and exit")
    parser.add_argument("--stub-model", action="store_true", help="dev only (NAZEER_ENGINE_DEV=1)")
    parser.add_argument(
        "--stub-mask",
        choices=("none", "ellipse"),
        default="none",
        help="with --stub-model: none = no detection; ellipse = a centred ellipse in every frame",
    )
    return parser.parse_args(argv)


def _bind(host: str, port: int) -> socket.socket:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows: no port sharing
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    sock.bind(("127.0.0.1" if host == "localhost" else host, port))
    sock.listen(128)
    return sock


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[attr-defined]
        except Exception:
            pass
    args = parse_args(argv)

    if args.dump_openapi:
        from .api.app import create_app

        spec = create_app(None).openapi()
        target = Path(args.dump_openapi)
        target.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return EXIT_OK

    if not args.data_root:
        return _fatal("data_root_required", "--data-root is required", EXIT_ARGS)

    from .settings import (
        DataRootError,
        Settings,
        apply_offline_env,
        dev_env_enabled,
        validate_data_root,
    )

    try:
        root = validate_data_root(args.data_root, allow_any=args.allow_any_data_root)
    except DataRootError as exc:
        return _fatal(exc.code, exc.message, EXIT_ARGS, **exc.details)
    apply_offline_env(root)

    from .logsetup import setup_logging

    log = setup_logging(root, level=args.log_level)
    lock = EngineLock(root / "engine.lock")
    if not lock.acquire():
        holder = lock.holder() or {}
        return _fatal(
            "engine_already_running",
            "another engine is serving this data root",
            EXIT_LOCKED,
            pid=holder.get("pid"),
            port=holder.get("port"),
        )
    try:
        from .assets import default_model_path
        from .constants import DEFAULT_CORS_ORIGINS, ENGINE_VERSION
        from .errors import EngineError

        model_path = Path(args.model) if args.model else default_model_path()
        warmup_ms: float | None = None
        if args.stub_mask != "none" and not args.stub_model:
            return _fatal("stub_mask_needs_stub_model", "--stub-mask needs --stub-model", EXIT_ARGS)
        if args.stub_model:
            if not dev_env_enabled():
                return _fatal(
                    "stub_model_not_allowed", "--stub-model needs NAZEER_ENGINE_DEV=1", EXIT_ARGS
                )
            from .segmenter import StubSegmenter, stub_ellipse_detection

            if args.stub_mask == "ellipse":
                segmenter: Any = StubSegmenter(stub_ellipse_detection, name="stub-ellipse")
            else:
                segmenter = StubSegmenter()
        else:
            from .segmenter import CamelSegmenter

            try:
                segmenter = CamelSegmenter(model_path)
                if not args.no_warmup:
                    warmup_ms = segmenter.warm_up()
            except EngineError as exc:
                return _fatal(exc.code, exc.message, EXIT_MODEL, **exc.details)
            except Exception as exc:  # torch / ultralytics failed to import or to load
                log.exception("model load failed")
                return _fatal(
                    "model_load_failed",
                    f"{type(exc).__name__}: {exc}",
                    EXIT_MODEL,
                    model=str(model_path),
                )

        from .api.state import build_state

        settings = Settings(
            data_root=root,
            model_path=model_path,
            host=args.host,
            port=args.port,
            token=args.token,
            cors_origins=tuple(args.cors_origin) if args.cors_origin else DEFAULT_CORS_ORIGINS,
            allow_null_origin=args.allow_null_origin,
            log_level=args.log_level,
            warmup=not args.no_warmup,
            allow_any_data_root=args.allow_any_data_root,
            stub_model=bool(args.stub_model),
        )
        state = build_state(settings, segmenter=segmenter, warmup_ms=warmup_ms)
        ready: dict[str, Any] = {
            "event": "ready",
            "port": None,
            "pid": os.getpid(),
            "engine_version": ENGINE_VERSION,
            "data_root": str(root),
            "model_file": getattr(segmenter, "weights_name", None),
            "model_sha256": getattr(segmenter, "sha256", None),
            "stub_model": bool(args.stub_model),
            "warmup_ms": warmup_ms,
            "token_required": bool(args.token),
            "arabic_stack_ok": bool(state.arabic.get("ok")),
            "boot": state.boot,
        }
        if args.check:
            ready["check"] = True
            _emit(ready)
            return EXIT_OK

        try:
            sock = _bind(args.host, args.port)
        except OSError as exc:
            return _fatal("port_in_use", f"cannot bind {args.host}:{args.port}: {exc}", EXIT_PORT)
        port = int(sock.getsockname()[1])
        lock.set_port(port)
        ready["port"] = port

        import uvicorn

        from .api.app import create_app

        app = create_app(state)
        config = uvicorn.Config(
            app,
            log_config=None,
            access_log=False,
            lifespan="on",
            timeout_graceful_shutdown=5,
        )
        server = uvicorn.Server(config)
        state.shutdown = lambda: setattr(server, "should_exit", True)
        app.state.on_ready = lambda: _emit(ready)
        log.info("serving", extra={"port": port, "data_root": str(root)})
        server.run(sockets=[sock])
        return EXIT_OK
    except Exception as exc:  # the supervisor gets one fatal line, never a silent crash
        log.exception("engine failed")
        return _fatal("unexpected", f"{type(exc).__name__}: {exc}", EXIT_UNEXPECTED)
    finally:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())
