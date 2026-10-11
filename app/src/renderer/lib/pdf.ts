/**
 * pdf.js behind a small interface, so the viewer can be tested with a fake and the library (and
 * its worker) load only when a PDF is first shown. Bundled, offline: the worker is a Vite asset
 * served from the app's own origin (CSP `worker-src 'self'`).
 *
 * pdf.js 6 has no `isEvalSupported` option any more (it no longer compiles glyphs with eval; the
 * CSP forbids eval anyway). WebAssembly decoders are turned off: Chromium's PDFs need no JPX or
 * JBIG2 decoding, ICC-based images fall back to their alternate colour space, and the CSP has no
 * 'wasm-unsafe-eval'. XFA forms and scripting stay off.
 */

export interface PdfViewportLike {
  width: number;
  height: number;
}

export interface PdfRenderTaskLike {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPageLike {
  getViewport(options: { scale: number }): PdfViewportLike;
  render(options: { canvas: HTMLCanvasElement; viewport: PdfViewportLike }): PdfRenderTaskLike;
  cleanup(): void;
}

/** The document; it is released by destroying its loading task (pdf.js 6). */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}

/** Load a PDF from bytes. pdf.js transfers the buffer to its worker, so it gets a copy. */
export type PdfLoader = (data: Uint8Array) => PdfLoadingTaskLike;

export const loadPdf: PdfLoader = (data) => {
  const copy = data.slice();
  let task: { promise: Promise<unknown>; destroy(): Promise<void> } | null = null;
  const promise = (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    task = pdfjs.getDocument({
      data: copy,
      useWasm: false,
      enableXfa: false,
      isOffscreenCanvasSupported: true,
      stopAtErrors: true,
    });
    return (await task.promise) as PdfDocumentLike;
  })();
  return {
    promise,
    destroy: async () => {
      await task?.destroy();
    },
  };
};
