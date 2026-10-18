import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import sessionFixture from "../../../../fixtures/session_view.json";
import { setEngineConnection } from "@/api/connection";
import { engineApi } from "@/api/engineApi";
import type { SessionView } from "@/api/types";
import { connectScriptedEngine, jsonResponse } from "@/test/engine";
import { sessionLoaded } from "../slices/session";
import { makeStore } from "../store";

afterEach(() => setEngineConnection(null));

const view = sessionFixture as unknown as SessionView;

describe("the lists follow the open session", () => {
  it("asks for History and the comparisons again when the session's status or image changes", async () => {
    const engine = connectScriptedEngine({
      "GET /comparisons": () => jsonResponse(200, { items: [], total: 0, reconciled: {} }),
    });
    const lists = () =>
      engine.requests.filter((r) => new URL(r.url).pathname === "/comparisons").length;
    const store = makeStore();
    const query = store.dispatch(engineApi.endpoints.listComparisons.initiate({}));
    await waitFor(() => expect(lists()).toBe(1));

    store.dispatch(sessionLoaded({ view: { ...view, status: "finalized" }, etag: null }));
    // an autosave of the same status and image changes nothing in the lists
    store.dispatch(
      sessionLoaded({ view: { ...view, status: "finalized", revision: 99 }, etag: null }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lists()).toBe(1);

    store.dispatch(sessionLoaded({ view: { ...view, status: "open" }, etag: null }));
    await waitFor(() => expect(lists()).toBe(2));
    query.unsubscribe();
  });
});
