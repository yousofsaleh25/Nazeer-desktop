import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { comparisonMember, comparisonView, historyRow } from "@/test/comparisons";
import { connectScriptedEngine, errorResponse, jsonResponse } from "@/test/engine";
import { makeStore } from "../store";
import { prepareCompareAgain } from "./comparisons";

afterEach(() => setEngineConnection(null));

const A = "20261017_100000_aaaaaa";
const B = "20261017_100500_bbbbbb";
const C = "20261017_101000_cccccc";

describe("Compare again", () => {
  it("keeps the order and cover, drops a deleted or ineligible camel and names why", async () => {
    const rows = {
      [A]: [historyRow(`${A}x`, "lookalike"), historyRow(A, "A")],
      [B]: [historyRow(B, "B", { eligible: false, reason: "reopened" })],
      [C]: [],
    } as Record<string, ReturnType<typeof historyRow>[]>;
    const engine = connectScriptedEngine({
      "GET /sessions": (_request, url) => {
        const items = rows[url.searchParams.get("q") ?? ""] ?? [];
        return jsonResponse(200, { items, total: items.length, reconciled: {} });
      },
    });
    const view = comparisonView({
      language: "ar",
      cover: { title: "T", event: "E", judge: "J", council: "K" },
      members: [
        comparisonMember(3, A, "A"),
        comparisonMember(1, B, "B"),
        comparisonMember(2, C, "C"),
      ],
    });
    const store = makeStore();
    expect(await store.dispatch(prepareCompareAgain(view))).toBeNull();
    const state = store.getState().comparisons;
    // the session searched by its id, the exact id picked (not the look-alike)
    expect(state.selection.map((m) => m.sessionId)).toEqual([A]);
    expect(state.dropped).toEqual([
      { sessionId: B, camelId: "B", group: "comparison_ineligible", reason: "reopened" },
      { sessionId: C, camelId: "C", group: "comparison_stale", reason: "member_deleted" },
    ]);
    expect(state).toMatchObject({
      dialogOpen: true,
      againFrom: view.comparison_id,
      language: "ar",
      cover: { title: "T", event: "E", judge: "J", council: "K" },
    });
    // positions 1, 2, 3 asked in that order
    const asked = engine.requests.map((r) => new URL(r.url).searchParams.get("q"));
    expect(asked).toEqual([B, C, A]);
  });

  it("nothing left: the dialog stays closed and every camel is named", async () => {
    connectScriptedEngine({
      "GET /sessions": () => jsonResponse(200, { items: [], total: 0, reconciled: {} }),
    });
    const store = makeStore();
    await store.dispatch(prepareCompareAgain(comparisonView()));
    expect(store.getState().comparisons).toMatchObject({ dialogOpen: false, selection: [] });
    expect(store.getState().comparisons.dropped).toHaveLength(2);
  });

  it("an engine error is returned and the selection is left alone", async () => {
    connectScriptedEngine({ "GET /sessions": () => errorResponse(503, "engine_not_ready") });
    const store = makeStore();
    const error = await store.dispatch(prepareCompareAgain(comparisonView()));
    expect(error?.code).toBe("engine_not_ready");
    expect(store.getState().comparisons.againFrom).toBeNull();
  });
});
