/**
 * Reading a sealed PDF's content in the test process with the app's own pdf.js (legacy build for
 * Node): pages and their size, the fonts each page sets, the text, the attachments. Content only,
 * never the PDF's bytes.
 */
import { createHash } from "node:crypto";

export interface PdfContent {
  /** in points */
  pages: { width: number; height: number }[];
  /** every font a page sets: its PDF name (a subset prefix + the face) and whether it is Type3 */
  fonts: { name: string; type3: boolean }[];
  text: string;
  attachments: Map<string, Uint8Array>;
}

export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // the app's own options (lib/pdf.ts), plus the font names
  const task = lib.getDocument({
    data: bytes.slice(),
    useWasm: false,
    stopAtErrors: true,
    fontExtraProperties: true,
  });
  const doc = await task.promise;
  try {
    const pages: PdfContent["pages"] = [];
    const fonts = new Map<string, boolean>();
    const text: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      pages.push({ width: x1 - x0, height: y1 - y0 });
      const ops = await page.getOperatorList();
      ops.fnArray.forEach((fn, i) => {
        if (fn !== lib.OPS.setFont) return;
        const id = (ops.argsArray[i] as [string])[0];
        if (!page.commonObjs.has(id)) return;
        const font = page.commonObjs.get(id) as { name?: string; isType3Font?: boolean };
        fonts.set(String(font.name), font.isType3Font === true);
      });
      const content = await page.getTextContent();
      for (const item of content.items) if ("str" in item) text.push(item.str);
    }
    const attachments = new Map<string, Uint8Array>();
    const listed = (await doc.getAttachments()) as Map<string, unknown> | null;
    for (const id of listed?.keys() ?? []) {
      const content = (await doc.getAttachmentContent(id)) as Uint8Array | undefined;
      if (content !== undefined) attachments.set(id, content);
    }
    return {
      pages,
      fonts: [...fonts].map(([name, type3]) => ({ name, type3 })),
      text: text.join(""),
      attachments,
    };
  } finally {
    await task.destroy();
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
