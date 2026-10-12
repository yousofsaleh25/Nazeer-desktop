import { describe, expect, it } from "vitest";
import { engineUrl } from "./urls";

const CONN = { baseUrl: "http://127.0.0.1:51234", token: "ab".repeat(32) };

describe("engineUrl", () => {
  it("makes an engine path absolute and adds the token", () => {
    expect(engineUrl(CONN, "/sessions/20261011_152956_e20a7c/assets/rgb.png")).toBe(
      `http://127.0.0.1:51234/sessions/20261011_152956_e20a7c/assets/rgb.png?token=${CONN.token}`,
    );
  });

  it("keeps an existing query (the overlay's ?v=) and replaces a stale token", () => {
    const url = new URL(engineUrl(CONN, "/sessions/x/assets/overlay_v2.png?v=2&token=old"));
    expect(url.searchParams.get("v")).toBe("2");
    expect(url.searchParams.getAll("token")).toEqual([CONN.token]);
  });

  it("accepts an absolute URL on the same engine, refuses any other origin", () => {
    expect(engineUrl(CONN, "http://127.0.0.1:51234/health")).toContain("/health?token=");
    expect(() => engineUrl(CONN, "http://127.0.0.1:9999/health")).toThrow();
    expect(() => engineUrl(CONN, "https://example.com/x")).toThrow();
    expect(() => engineUrl(CONN, "//example.com/x")).toThrow();
  });
});
