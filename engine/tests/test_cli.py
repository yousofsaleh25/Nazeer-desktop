"""The sidecar process exactly as Electron spawns it (readiness line, exit codes, lock)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import psutil
import pytest

ENGINE_DIR = Path(__file__).resolve().parents[1]


def _env(dev: bool = True) -> dict[str, str]:
    env = dict(os.environ)
    if dev:
        env["NAZEER_ENGINE_DEV"] = "1"
    else:
        env.pop("NAZEER_ENGINE_DEV", None)
    env.pop("PYTHONUTF8", None)  # prove the engine does not depend on it
    return env


def _run(args: list[str], *, dev: bool = True, timeout: float = 180) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "nazeer_engine", *args],
        cwd=str(ENGINE_DIR),
        env=_env(dev),
        capture_output=True,
        timeout=timeout,
    )


def _lines(stdout: bytes) -> list[dict]:
    return [json.loads(line) for line in stdout.decode("ascii").splitlines() if line.strip()]


def test_dump_openapi(tmp_path: Path):
    out = tmp_path / "openapi.json"
    result = _run(["--dump-openapi", str(out)])
    assert result.returncode == 0, result.stderr[-2000:]
    spec = json.loads(out.read_text(encoding="utf-8"))
    assert "/sessions/{session_id}/document" in spec["paths"]


def test_check_under_an_arabic_data_root_prints_one_ascii_ready_line(tmp_path: Path):
    root = tmp_path / "بيانات"
    result = _run(["--data-root", str(root), "--stub-model", "--check"])
    assert result.returncode == 0, result.stderr[-2000:]
    lines = _lines(result.stdout)
    assert len(lines) == 1 and lines[0]["event"] == "ready" and lines[0]["check"] is True
    assert lines[0]["data_root"] == str(root) and lines[0]["stub_model"] is True
    assert (root / "sessions").is_dir() and (root / "history.sqlite").is_file()
    assert (root / "logs" / "engine.log").is_file()


def test_bad_data_root_model_and_stub_rules(tmp_path: Path):
    docs = _run(["--data-root", str(tmp_path / "Documents" / "nazeer"), "--stub-model", "--check"])
    assert docs.returncode == 2 and _lines(docs.stdout)[0]["code"] == "data_root_invalid"
    relative = _run(["--data-root", "relative/root", "--stub-model", "--check"])
    assert relative.returncode == 2
    fake = tmp_path / "fake.pt"
    fake.write_bytes(b"not the pinned model")
    model = _run(["--data-root", str(tmp_path / "root"), "--model", str(fake), "--check"])
    assert model.returncode == 3 and _lines(model.stdout)[0]["code"] == "model_hash_mismatch"
    no_dev = _run(["--data-root", str(tmp_path / "root2"), "--stub-model", "--check"], dev=False)
    assert no_dev.returncode == 2 and _lines(no_dev.stdout)[0]["code"] == "stub_model_not_allowed"


def test_serve_health_lock_and_graceful_shutdown(tmp_path: Path):
    root = tmp_path / "root"
    err_path = tmp_path / "engine.stderr"
    err = err_path.open("wb")  # a file, not a pipe: an unread pipe can block the engine
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "nazeer_engine",
            "--data-root",
            str(root),
            "--stub-model",
            "--port",
            "0",
        ],
        cwd=str(ENGINE_DIR),
        env=_env(),
        stdout=subprocess.PIPE,
        stderr=err,
    )
    first: list[bytes] = []
    reader = threading.Thread(target=lambda: first.append(proc.stdout.readline()))  # type: ignore[union-attr]
    reader.start()
    reader.join(120)
    try:
        assert first and first[0], f"no readiness line: {err_path.read_bytes()[-2000:]!r}"
        ready = json.loads(first[0])
        assert ready["event"] == "ready" and isinstance(ready["port"], int) and ready["port"] > 0
        base = f"http://127.0.0.1:{ready['port']}"
        with urllib.request.urlopen(f"{base}/health", timeout=30) as resp:
            health = json.loads(resp.read())
        assert health["status"] == "ok" and health["pid"] == ready["pid"]
        # A venv python.exe on Windows is a launcher that runs the real interpreter as a
        # child, so the engine pid is the spawned pid or its child. The supervisor identifies
        # the engine by the ready line's pid and still stops it through the spawned process.
        assert ready["pid"] == proc.pid or psutil.Process(ready["pid"]).ppid() == proc.pid
        lock = json.loads((root / "engine.lock").read_text(encoding="utf-8"))
        assert lock["pid"] == ready["pid"] and lock["port"] == ready["port"]
        second = _run(["--data-root", str(root), "--stub-model", "--check"])
        assert (
            second.returncode == 6 and _lines(second.stdout)[0]["code"] == "engine_already_running"
        )
        request = urllib.request.Request(f"{base}/system/shutdown", method="POST", data=b"")
        with urllib.request.urlopen(request, timeout=30) as resp:
            assert resp.status == 202
        assert proc.wait(timeout=60) == 0
        rest = proc.stdout.read()  # type: ignore[union-attr]
        assert rest.strip() == b"", rest  # exactly one stdout line for the supervisor
        assert not (root / "engine.lock").exists()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(10)
        proc.stdout.close()  # type: ignore[union-attr]
        err.close()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows code page behaviour")
def test_piped_stdout_survives_a_non_utf8_code_page(tmp_path: Path):
    env = _env()
    env["PYTHONIOENCODING"] = "cp1252"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "nazeer_engine",
            "--data-root",
            str(tmp_path / "جذر"),
            "--stub-model",
            "--check",
        ],
        cwd=str(ENGINE_DIR),
        env=env,
        capture_output=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert _lines(result.stdout)[0]["event"] == "ready"


# ----- review fixes: the single-instance lock and model-load failures -------------------------


def _lock_module():
    from nazeer_engine.__main__ import EngineLock

    return EngineLock


def test_engine_lock_is_exclusive_and_replaces_only_stale_locks(tmp_path: Path):
    EngineLock = _lock_module()
    path = tmp_path / "engine.lock"
    parent = psutil.Process(os.getppid())  # alive for the whole test
    path.write_text(json.dumps({"pid": parent.pid, "create_time": parent.create_time()}), "utf-8")
    assert not EngineLock(path).acquire()  # a live foreign holder wins
    dead = subprocess.run(
        [sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True
    )
    path.write_text(json.dumps({"pid": int(dead.stdout), "create_time": 1.0}), "utf-8")
    lock = EngineLock(path)
    assert lock.acquire() and json.loads(path.read_text("utf-8"))["pid"] == os.getpid()
    lock.set_port(4321)
    assert json.loads(path.read_text("utf-8"))["port"] == 4321
    lock.release()
    assert not path.exists()
    path.write_text("", "utf-8")  # another engine just created it and is still writing
    assert not EngineLock(path).acquire()
    old = time.time() - 10
    os.utime(path, (old, old))  # an empty lock left by a crash is stale after 2 s
    other = EngineLock(path)
    assert other.acquire()
    path.write_text(json.dumps({"pid": parent.pid, "create_time": parent.create_time()}), "utf-8")
    other.set_port(1)  # never writes into a lock that is no longer ours
    other.release()  # and never deletes it
    assert json.loads(path.read_text("utf-8"))["pid"] == parent.pid


def test_a_model_that_fails_to_load_exits_3(tmp_path: Path, monkeypatch, capsysbinary):
    import logging

    from nazeer_engine import __main__ as entry
    from nazeer_engine import segmenter

    class Broken:
        def __init__(self, *_a, **_k):
            raise AttributeError("module 'torch' has no attribute '_utils'")

    monkeypatch.setattr(segmenter, "CamelSegmenter", Broken)
    saved = logging.root.handlers[:]
    try:
        code = entry.main(["--data-root", str(tmp_path / "root"), "--check"])
    finally:
        for handler in logging.root.handlers:
            if handler not in saved:
                handler.close()
        logging.root.handlers[:] = saved
    out = capsysbinary.readouterr().out
    assert code == 3, out
    fatal = json.loads(out.decode("ascii").strip().splitlines()[-1])
    assert fatal["event"] == "fatal" and fatal["code"] == "model_load_failed"
    assert not (tmp_path / "root" / "engine.lock").exists()
