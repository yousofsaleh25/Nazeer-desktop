import { describe, expect, it } from "vitest";
import { buildCsp, cspPageFor } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("buildCsp", () => {
  it("production app page: scripts only from the app, no inline or eval, engine on loopback only", () => {
    const csp = directives(buildCsp({ page: "app", devServerOrigin: null }));
    expect(csp.get("script-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'", "http://127.0.0.1:*"]);
    expect(csp.get("img-src")).toContain("http://127.0.0.1:*");
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    const all = [...csp.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all.some((v) => /^https?:\/\/(?!127\.0\.0\.1:\*)/.test(v))).toBe(false);
  });

  it("dev app page adds only the Fast Refresh preamble and the HMR websocket", () => {
    const prod = directives(buildCsp({ page: "app", devServerOrigin: null }));
    const dev = directives(buildCsp({ page: "app", devServerOrigin: "http://localhost:5174" }));
    expect(dev.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(dev.get("connect-src")).toEqual(["'self'", "http://127.0.0.1:*", "ws://localhost:5174"]);
    for (const name of ["img-src", "font-src", "object-src", "frame-ancestors"]) {
      expect(dev.get(name)).toEqual(prod.get(name));
    }
  });

  it("production print page has no network and takes images from blobs only", () => {
    const csp = directives(buildCsp({ page: "print", devServerOrigin: null }));
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("connect-src")).toEqual(["'none'"]);
    expect(csp.get("img-src")).toEqual(["blob:", "data:"]);
    expect(csp.get("script-src")).toEqual(["'self'"]);
  });
});

describe("cspPageFor", () => {
  it("routes /print/ paths to the print policy", () => {
    expect(cspPageFor("/print/print.html")).toBe("print");
    expect(cspPageFor("/renderer/index.html")).toBe("app");
    expect(cspPageFor("/assets/index.js")).toBe("app");
  });
});
