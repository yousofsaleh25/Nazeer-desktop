import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import meta from "../../../fixtures/_meta.json";

// The report the engine sealed for the dev data root's session (runs/ is local and gitignored, so
// this check runs only where that session exists). It shows that the bundled pdf.js opens a real
// Chromium-printed, engine-sealed PDF with the app's options (no WebAssembly).
const pdfPath = join(meta.data_root, "sessions", meta.session_id, "report_v1.pdf");

describe("pdf.js 6 with the engine's real PDF", () => {
  it.skipIf(!existsSync(pdfPath))(
    "opens the sealed report without WebAssembly and reads its text layer",
    async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const data = new Uint8Array(readFileSync(pdfPath));
      const task = pdfjs.getDocument({ data, useWasm: false, stopAtErrors: true });
      const doc = await task.promise;
      try {
        expect(doc.numPages).toBe(5); // probe_pass.json: n_pages 5
        const words: string[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const content = await (await doc.getPage(n)).getTextContent();
          for (const item of content.items) if ("str" in item) words.push(item.str);
        }
        const text = words.join(" ");
        expect(text).toContain("Random 3D distance 1");
        expect(text).toContain("20261011_152956_e20a7c");
        // the engine's evidence files (pdf.js 6 lists them in a Map)
        const attachments: unknown = await doc.getAttachments();
        const names =
          attachments instanceof Map ? [...attachments.keys()] : Object.keys(attachments ?? {});
        expect(names.sort()).toEqual(["overlay_v1.png", "report_model.json", "session.json"]);
      } finally {
        await task.destroy();
      }
    },
    30_000,
  );
});
