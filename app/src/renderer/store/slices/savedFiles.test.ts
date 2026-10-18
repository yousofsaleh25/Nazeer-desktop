import { afterEach, describe, expect, it, vi } from "vitest";
import type { NazeerApi, SavedCopyQuery } from "@shared/ipc";
import { makeStore } from "../store";
import { loadSavedCopy, openSavedCopy, saveReportCopy, takeSaveOffer } from "../thunks/savedFiles";
import { saveOfferCleared, saveOffered, savedFileKey, savedFileOf } from "./savedFiles";

const ref: SavedCopyQuery = { kind: "session", id: "20261014_101500_abc123", version: 2 };

type Report = NazeerApi["report"];

function bridge(over: Partial<Report> = {}) {
  const report: Report = {
    saveAs: vi.fn<Report["saveAs"]>(() => Promise.resolve({ state: "cancelled" })),
    savedCopy: vi.fn<Report["savedCopy"]>(() => Promise.resolve(null)),
    openSaved: vi.fn<Report["openSaved"]>(() => Promise.resolve({ ok: true })),
    ...over,
  };
  (window as { nazeer?: Partial<NazeerApi> }).nazeer = { report };
  return report;
}

afterEach(() => {
  delete (window as { nazeer?: unknown }).nazeer;
});

describe("savedFiles", () => {
  it("keys entries by report version", () => {
    expect(savedFileKey(ref)).toBe("session:20261014_101500_abc123:v2");
  });

  it("a saved copy is remembered with its place; a cancel changes nothing", async () => {
    const store = makeStore();
    bridge({
      saveAs: vi.fn<Report["saveAs"]>(() =>
        Promise.resolve({
          state: "saved",
          path: "D:\\a.pdf",
          version: 2,
          bytes: 1,
          sha256: "a".repeat(64),
          savedAt: "2026-10-17T10:00:00.000Z",
          recorded: false,
        }),
      ),
    });
    await store.dispatch(saveReportCopy(ref, "a.pdf"));
    expect(savedFileOf(store.getState().savedFiles, ref)).toMatchObject({
      checked: true,
      saving: false,
      unrecorded: true,
      copy: { path: "D:\\a.pdf", exists: true, changed: false },
    });
  });

  it("without the app's bridge, a save fails with bridge_missing", async () => {
    const store = makeStore();
    const result = await store.dispatch(saveReportCopy(ref, "a.pdf"));
    expect(result).toMatchObject({ state: "failed", error: { code: "bridge_missing" } });
    expect(savedFileOf(store.getState().savedFiles, ref).error?.code).toBe("bridge_missing");
  });

  it("the offer after a seal is taken once, for that report only", async () => {
    const store = makeStore();
    const saveAs = vi.fn<Report["saveAs"]>(() => Promise.resolve({ state: "cancelled" }));
    bridge({ saveAs });
    store.dispatch(saveOffered(ref));
    // another report version does not take it
    expect(await store.dispatch(takeSaveOffer({ ...ref, version: 1 }, "a.pdf"))).toBeNull();
    await Promise.all([
      store.dispatch(takeSaveOffer(ref, "a.pdf")),
      store.dispatch(takeSaveOffer(ref, "a.pdf")),
    ]);
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(store.getState().savedFiles.offer).toBeNull();
  });

  it("an offer for another report survives a targeted clear; a plain clear drops it", () => {
    const store = makeStore();
    store.dispatch(saveOffered(ref));
    store.dispatch(saveOfferCleared({ ...ref, id: "20261014_101500_ffffff" }));
    expect(store.getState().savedFiles.offer).toEqual(ref);
    store.dispatch(saveOfferCleared());
    expect(store.getState().savedFiles.offer).toBeNull();
  });

  it("a copy that cannot be opened is reported, and main is asked again where it is", async () => {
    const store = makeStore();
    const savedCopy = vi.fn<Report["savedCopy"]>(() => Promise.resolve(null));
    bridge({
      savedCopy,
      openSaved: vi.fn<Report["openSaved"]>(() =>
        Promise.resolve({
          ok: false,
          error: { status: null, code: "save_as_copy_missing", message: "gone", details: {} },
        }),
      ),
    });
    const error = await store.dispatch(openSavedCopy(ref, "open"));
    expect(error?.code).toBe("save_as_copy_missing");
    expect(savedCopy).toHaveBeenCalledWith(ref);
    expect(savedFileOf(store.getState().savedFiles, ref)).toMatchObject({
      checked: true,
      error: { code: "save_as_copy_missing" },
    });
  });

  it("loads the recorded copy", async () => {
    const store = makeStore();
    const copy = {
      path: "D:\\a.pdf",
      savedAt: "2026-10-17T10:00:00.000Z",
      sha256: "a".repeat(64),
      bytes: 1,
      exists: true,
      changed: false,
    };
    bridge({ savedCopy: vi.fn<Report["savedCopy"]>(() => Promise.resolve(copy)) });
    await store.dispatch(loadSavedCopy(ref));
    expect(savedFileOf(store.getState().savedFiles, ref)).toMatchObject({ checked: true, copy });
  });
});
