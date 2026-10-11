import { describe, expect, it } from "vitest";
import notFound from "../../../fixtures/error_404_session.json";
import stale from "../../../fixtures/error_409_stale_revision.json";
import unauthorized from "../../../fixtures/error_401_unauthorized.json";
import validation from "../../../fixtures/error_422_validation.json";
import { appError, errorFromDetail, errorFromResponse, networkError } from "./errors";

describe("errorFromResponse", () => {
  it("reads the engine's envelope (real fixtures)", () => {
    expect(errorFromResponse(404, notFound)).toEqual({
      status: 404,
      code: "session_not_found",
      message: "session not found",
      details: { session_id: "20000101_000000_abcdef" },
    });
    expect(errorFromResponse(401, unauthorized).code).toBe("unauthorized");
    expect(errorFromResponse(422, validation).details).toHaveProperty("errors");
    // a stale save carries the full current view to rebase onto
    const conflict = errorFromResponse(409, stale);
    expect(conflict.code).toBe("stale_revision");
    expect(conflict.details).toHaveProperty("current.session_id");
  });

  it("turns a body that is not an envelope into the engine's generic http_error", () => {
    expect(errorFromResponse(502, "Bad Gateway")).toEqual({
      status: 502,
      code: "http_error",
      message: "HTTP 502",
      details: { body: "Bad Gateway" },
    });
    expect(errorFromResponse(500, null).details).toEqual({});
    expect(errorFromResponse(500, { error: { code: "" } }).code).toBe("http_error");
  });

  it("keeps a missing message or details as empty values, never undefined", () => {
    expect(errorFromResponse(409, { error: { code: "job_busy" } })).toEqual({
      status: 409,
      code: "job_busy",
      message: "",
      details: {},
    });
  });
});

describe("other error sources", () => {
  it("a failed job's error", () => {
    expect(
      errorFromDetail({ code: "bag_unreadable", message: "cannot open", details: { path: "x" } }),
    ).toEqual({
      status: null,
      code: "bag_unreadable",
      message: "cannot open",
      details: { path: "x" },
    });
  });

  it("network failures and the app's own checks have no HTTP status", () => {
    expect(networkError(new TypeError("Failed to fetch"))).toEqual({
      status: null,
      code: "network_error",
      message: "Failed to fetch",
      details: {},
    });
    expect(appError("overlay_hash_mismatch", "sha differs", { expected: "a" }).status).toBeNull();
  });
});
