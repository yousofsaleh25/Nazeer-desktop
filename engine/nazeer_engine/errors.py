"""Typed errors: every API error body is ``{"error": {"code", "message", "details"}}``."""

from __future__ import annotations

from typing import Any


class EngineError(Exception):
    """Base class; ``code`` and ``status`` map directly to the HTTP error body."""

    code: str = "engine_error"
    status: int = 500

    def __init__(
        self,
        message: str = "",
        *,
        code: str | None = None,
        status: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or code or self.code)
        self.message = message or (code or self.code)
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status
        self.details: dict[str, Any] = dict(details or {})

    def to_body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class NotFound(EngineError):
    code = "not_found"
    status = 404


class Conflict(EngineError):
    code = "conflict"
    status = 409


class Unprocessable(EngineError):
    code = "unprocessable"
    status = 422


class Unauthorized(EngineError):
    code = "unauthorized"
    status = 401


class ServiceUnavailable(EngineError):
    code = "service_unavailable"
    status = 503


class AtomicWriteError(ServiceUnavailable):
    """A session/candidate file could not be written even after the retry ladder (C3.4)."""

    code = "save_failed"


class CorruptFileError(EngineError):
    """A JSON file on disk is torn or unparsable."""

    code = "corrupt_file"
    status = 500


class UnsupportedSchemaVersion(Unprocessable):
    code = "unsupported_schema_version"


class ModelHashMismatch(EngineError):
    code = "model_hash_mismatch"
    status = 500


class ModelContractError(EngineError):
    """The model violated the inference contract (e.g. a retina mask of the wrong shape)."""

    code = "model_contract_violation"
    status = 500


class ArabicStackMissing(EngineError):
    code = "arabic_stack_missing"
    status = 500


class BagNotFound(NotFound):
    code = "bag_not_found"


class BagError(Unprocessable):
    code = "bag_unreadable"


class BagReadStalled(EngineError):
    code = "bag_read_stalled"
    status = 500


class JobCancelled(Exception):
    """Control flow inside the candidate walk: the operator cancelled."""


class JobStopped(Exception):
    """Control flow inside the candidate walk: stop reading, keep the best so far."""
