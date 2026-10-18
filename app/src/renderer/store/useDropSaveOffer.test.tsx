import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import type { SavedCopyQuery } from "@shared/ipc";
import { saveOffered } from "./slices/savedFiles";
import { makeStore } from "./store";
import { useDropSaveOfferOnLeave } from "./useDropSaveOffer";

const ref: SavedCopyQuery = { kind: "session", id: "20261014_101500_eeeeee", version: 1 };

function Screen({ report }: { report: SavedCopyQuery }) {
  useDropSaveOfferOnLeave(report);
  return null;
}

const flush = () => act(() => Promise.resolve());

describe("useDropSaveOfferOnLeave", () => {
  it("StrictMode's remount keeps the offer; leaving the screen drops it", async () => {
    const store = makeStore();
    store.dispatch(saveOffered(ref));
    const view = render(
      <StrictMode>
        <Provider store={store}>
          <Screen report={ref} />
        </Provider>
      </StrictMode>,
    );
    await flush();
    expect(store.getState().savedFiles.offer).toEqual(ref);
    view.unmount();
    await flush();
    expect(store.getState().savedFiles.offer).toBeNull();
  });

  it("leaves another report's offer alone", async () => {
    const store = makeStore();
    const other: SavedCopyQuery = { kind: "comparison", id: "20261017_100000_cccccc", version: 2 };
    store.dispatch(saveOffered(other));
    const view = render(
      <Provider store={store}>
        <Screen report={ref} />
      </Provider>,
    );
    view.unmount();
    await flush();
    expect(store.getState().savedFiles.offer).toEqual(other);
  });
});
