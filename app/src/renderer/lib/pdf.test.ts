import { describe, expect, it, vi } from "vitest";

const { getDocument, GlobalWorkerOptions } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/assets/pdf.worker.min.mjs",
}));

describe("loadPdf", () => {
  it("bundled worker, no WebAssembly, no XFA, a copy of the bytes", async () => {
    const doc = { numPages: 5 };
    const destroy = vi.fn(() => Promise.resolve());
    getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy });
    const { loadPdf } = await import("./pdf");
    const bytes = new Uint8Array([1, 2, 3]);
    const task = loadPdf(bytes);
    await expect(task.promise).resolves.toBe(doc);
    expect(GlobalWorkerOptions.workerSrc).toBe("/assets/pdf.worker.min.mjs");
    const options = getDocument.mock.calls[0]![0] as Record<string, unknown>;
    expect(options).toMatchObject({ useWasm: false, enableXfa: false, stopAtErrors: true });
    // pdf.js transfers its input to the worker: the caller's bytes must survive
    expect(options["data"]).not.toBe(bytes);
    expect(options["data"]).toEqual(bytes);
    await task.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
