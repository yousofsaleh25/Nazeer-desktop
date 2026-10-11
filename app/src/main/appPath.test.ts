import path from "node:path";
import { describe, expect, it } from "vitest";
import { mimeType, resolveAppPath } from "./appPath";

const root = path.resolve("C:/nazeer/out/renderer");

describe("resolveAppPath", () => {
  it("maps app://nazeer paths below the renderer folder", () => {
    expect(resolveAppPath(root, "app://nazeer/renderer/index.html")).toBe(
      path.join(root, "renderer", "index.html"),
    );
    expect(resolveAppPath(root, "app://nazeer/assets/index-abc.js?v=1#x")).toBe(
      path.join(root, "assets", "index-abc.js"),
    );
    expect(resolveAppPath(root, "app://nazeer/assets/%D8%AE%D8%B7.png")).toBe(
      path.join(root, "assets", "خط.png"),
    );
  });

  it.each([
    ["another host", "app://evil/renderer/index.html"],
    ["another scheme", "file:///C:/nazeer/out/renderer/renderer/index.html"],
    ["the bare origin", "app://nazeer/"],
    ["an encoded slash + parent", "app://nazeer/assets%2F..%2F..%2Fsecret.txt"],
    ["an encoded backslash", "app://nazeer/..%5C..%5Csecret.txt"],
    ["a drive letter", "app://nazeer/C:/Windows/win.ini"],
    ["an alternate data stream", "app://nazeer/renderer/index.html:stream"],
    ["a NUL byte", "app://nazeer/renderer/index.html%00.png"],
    ["broken percent encoding", "app://nazeer/%E0%A4%A"],
    ["not a URL", "nazeer/renderer/index.html"],
  ])("refuses %s", (_label, url) => {
    expect(resolveAppPath(root, url)).toBeNull();
  });

  it("never returns a path outside the root, whatever the dot segments", () => {
    // the URL parser itself folds "..", "%2e%2e" and "." segments before we see the path
    for (const url of [
      "app://nazeer/../../secret.txt",
      "app://nazeer/renderer/../../../secret.txt",
      "app://nazeer/%2e%2e/%2E%2E/secret.txt",
      "app://nazeer/./renderer/./index.html",
    ]) {
      const file = resolveAppPath(root, url);
      if (file !== null) {
        const relative = path.relative(root, file);
        expect(relative.startsWith("..") || path.isAbsolute(relative), url).toBe(false);
      }
    }
  });
});

describe("mimeType", () => {
  it("serves scripts, styles, fonts and wasm with their real types", () => {
    expect(mimeType("a/index.html")).toBe("text/html; charset=utf-8");
    expect(mimeType("a/index.JS")).toBe("text/javascript; charset=utf-8");
    expect(mimeType("a/x.woff2")).toBe("font/woff2");
    expect(mimeType("a/pdf.worker.min.mjs")).toBe("text/javascript; charset=utf-8");
    expect(mimeType("a/x.wasm")).toBe("application/wasm");
    expect(mimeType("a/unknown.bin")).toBe("application/octet-stream");
  });
});
