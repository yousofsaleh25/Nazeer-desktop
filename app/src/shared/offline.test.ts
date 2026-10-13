import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The app runs offline (CLAUDE.md): its own sources name no remote host (no CDN script or
// stylesheet, no web font, no remote fetch) and nothing reaches out of the machine on its own (no
// updater, crash upload or external link). The other half is the policy: csp.test.ts. Dependencies
// are bundled into the build, so the sources and the policy are what this test covers.
const APP = resolve(__dirname, "../..");
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(full);
    return /\.(tsx?|css|html)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sources(join(APP, "src")).map((file) => ({
  name: relative(APP, file),
  text: readFileSync(file, "utf8"),
}));

describe("the app's sources, offline", () => {
  it("name only the loopback engine (or a .invalid placeholder) as a host", () => {
    expect(files.length).toBeGreaterThan(100);
    const remote: string[] = [];
    for (const { name, text } of files) {
      for (const match of text.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)) {
        const host = (match[1] ?? "").toLowerCase();
        if (!LOOPBACK.has(host) && !host.endsWith(".invalid")) remote.push(`${name}: ${match[0]}`);
      }
      for (const match of text.matchAll(/["'(]\/\/[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g)) {
        remote.push(`${name}: protocol-relative ${match[0]}`);
      }
    }
    expect(remote).toEqual([]);
  });

  it("load no stylesheet or font from a URL and have no updater, crash upload or external link", () => {
    const banned =
      /@import\s+url\(|autoUpdater|electron-updater|crashReporter|openExternal|\bnet\.(request|fetch)\b|\bhttps\.(request|get)\b/;
    for (const { name, text } of files) expect(text, name).not.toMatch(banned);
  });
});
