import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionReportFileName } from "@shared/fileNames";
import type { NazeerApi } from "@shared/ipc";
import historyFixture from "../../../fixtures/history_list.json";
import sessionFixture from "../../../fixtures/session_view.json";
import { setEngineConnection } from "@/api/connection";
import type { HistoryList } from "@/api/types";
import { sampleStats } from "@/design/samples";
import { comparisonRow, COMPARISON_ID, historyRow } from "@/test/comparisons";
import { connectScriptedEngine, engineState, errorResponse, jsonResponse } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { HistoryScreen } from "./HistoryScreen";

const list = historyFixture as unknown as HistoryList;
const row = list.items[0]!;
const id = row.session_id;

function setup(deleteAnswers: (() => Response)[] = []) {
  let rows = [...list.items];
  const engine = connectScriptedEngine({
    "GET /sessions": () => jsonResponse(200, { ...list, items: rows, total: rows.length }),
    "GET /history/stats": () => jsonResponse(200, sampleStats),
    [`DELETE /sessions/${id}`]: () => {
      const answer = deleteAnswers.shift();
      if (answer !== undefined) return answer();
      rows = [];
      return jsonResponse(200, { deleted: true, trashed_to: "trash/x" });
    },
    [`GET /sessions/${id}`]: () => jsonResponse(200, sessionFixture, { ETag: '"r9-a"' }),
    [`POST /sessions/${id}/reopen`]: () =>
      jsonResponse(200, { ...sessionFixture, status: "open" }, { ETag: '"r9-b"' }),
    "POST /history/backup": () =>
      jsonResponse(200, { path: "E:\\data\\backups\\h.sqlite", bytes: 9 }),
  });
  const view = renderRoutes([{ path: "/history", element: <HistoryScreen /> }], "/history", {
    preloadedState: { ...uiState("en"), engine: engineState() },
  });
  const calls = () =>
    engine.requests.map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`);
  return { ...view, calls, user: userEvent.setup() };
}

afterEach(() => {
  setEngineConnection(null);
  delete (window as { nazeer?: unknown }).nazeer;
});

describe("History", () => {
  it("lists the engine's sessions with the maintenance panel", async () => {
    setup();
    expect(await screen.findByText(row.camel_id)).toBeInTheDocument();
    expect(screen.getByText("Data and maintenance")).toBeInTheDocument();
    expect(screen.getByText("Last check of the session folders")).toBeInTheDocument();
  });

  it("the search waits for typing to pause, then asks the engine", async () => {
    const { calls, user } = setup();
    await screen.findByText(row.camel_id);
    await user.type(screen.getByRole("searchbox"), "جمل");
    await waitFor(() =>
      expect(calls().some((c) => c.startsWith("GET /sessions?") && c.includes("q="))).toBe(true),
    );
    const searches = calls().filter((c) => c.includes("q="));
    expect(searches).toHaveLength(1);
    expect(decodeURIComponent(searches[0]!)).toContain("q=جمل");
  });

  it("delete asks first, tries a busy session again, and the row goes", async () => {
    const { calls, user } = setup([() => errorResponse(409, "session_busy")]);
    await screen.findByText(row.camel_id);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete the session?");
    expect(dialog).toHaveTextContent(id);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText(row.camel_id)).toBeNull(), { timeout: 3000 });
    expect(calls().filter((c) => c.startsWith("DELETE"))).toHaveLength(2);
    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
  });

  it("a delete that fails stays visible with the engine's reason", async () => {
    const { user } = setup([() => errorResponse(409, "delete_failed")]);
    await screen.findByText(row.camel_id);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByText("Delete failed (is a file open?)")).toBeInTheDocument();
    expect(screen.getByText(row.camel_id)).toBeInTheDocument();
  });

  it("reopen makes a sealed session editable and opens it", async () => {
    const { calls, router, user } = setup();
    await screen.findByText(row.camel_id);
    await user.click(screen.getByRole("button", { name: "Reopen for editing" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/sessions/${id}`));
    expect(calls()).toEqual(
      expect.arrayContaining([`GET /sessions/${id}`, `POST /sessions/${id}/reopen`]),
    );
  });

  it("back up writes the copy the engine reports", async () => {
    const { user } = setup();
    await screen.findByText(row.camel_id);
    await user.click(screen.getByRole("button", { name: "Back up history" }));
    expect(await screen.findByText("Backup written")).toBeInTheDocument();
  });

  it("Save PDF as… asks main for a copy of the row's sealed report, then shows where (D12)", async () => {
    type Report = NazeerApi["report"];
    const saveAs = vi.fn<Report["saveAs"]>((request) =>
      Promise.resolve({
        state: "saved",
        path: String.raw`D:\تقارير` + "\\" + request.suggestedName,
        version: request.version,
        bytes: 1,
        sha256: "a".repeat(64),
        savedAt: "2026-10-17T10:00:00.000Z",
        recorded: true,
      }),
    );
    const openSaved = vi.fn<Report["openSaved"]>(() => Promise.resolve({ ok: true }));
    (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
      report: { saveAs, savedCopy: () => Promise.resolve(null), openSaved },
    };
    const { user } = setup();
    await screen.findByText(row.camel_id);
    await user.click(screen.getByRole("button", { name: "Save PDF as…" }));
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    expect(saveAs.mock.calls[0]?.[0]).toEqual({
      kind: "session",
      id,
      version: row.report_version,
      suggestedName: sessionReportFileName({
        camelId: row.camel_id,
        sessionId: id,
        createdAt: row.created_at,
        version: row.report_version,
      }),
    });
    const notice = await screen.findByTestId("history-save-copy");
    expect(within(notice).getByText("Saved to:")).toBeInTheDocument();
    await user.click(within(notice).getByRole("button", { name: "Show in folder" }));
    expect(openSaved).toHaveBeenCalledWith({
      kind: "session",
      id,
      version: row.report_version,
      action: "show",
    });
  });
});

describe("History and comparisons (D12)", () => {
  const A = "20261017_100000_aaaaaa";
  const B = "20261017_100100_bbbbbb";
  const rows = [
    historyRow(A, "camel-A", { event: "Ev", nComparisons: 2 }),
    historyRow(B, "camel-B", { sealed: true, event: "Ev" }),
  ];

  function setupD12(lang: "en" | "ar" = "en", path = "/history") {
    const engine = connectScriptedEngine({
      "GET /sessions": () => jsonResponse(200, { items: rows, total: rows.length, reconciled: {} }),
      "GET /history/stats": () => jsonResponse(200, sampleStats),
      "GET /comparisons": () =>
        jsonResponse(200, { items: [comparisonRow()], total: 1, reconciled: {} }),
    });
    const view = renderRoutes([{ path: "/history", element: <HistoryScreen /> }], path, {
      preloadedState: { ...uiState(lang), engine: engineState() },
    });
    const calls = () =>
      engine.requests.map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`);
    return { ...view, calls, user: userEvent.setup() };
  }

  it("ticks camels, counts them against the engine's maximum and opens the Compare dialog", async () => {
    const { user, store } = setupD12();
    await screen.findByText("camel-A");
    expect(screen.queryByTestId("compare-bar")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select for a comparison camel-B" }));
    await user.click(screen.getByRole("checkbox", { name: "Select for a comparison camel-A" }));
    expect(screen.getByTestId("compare-bar")).toHaveTextContent("2 / 20");
    await user.click(screen.getByRole("button", { name: "Compare 2" }));
    const dialog = await screen.findByTestId("compare-dialog");
    // the operator's order (ticked B first), not the list's
    const order = [...dialog.querySelectorAll("li[data-session]")].map((li) =>
      li.getAttribute("data-session"),
    );
    expect(order).toEqual([B, A]);
    // the cover starts from the event both camels share
    expect(within(dialog).getByRole("textbox", { name: "Event" })).toHaveValue("Ev");
    expect(store.getState().comparisons.dialogOpen).toBe(true);
  });

  it("'Select all shown' and Clear", async () => {
    const { user, store } = setupD12();
    await screen.findByText("camel-A");
    await user.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(store.getState().comparisons.selection.map((m) => m.sessionId)).toEqual([A, B]);
    expect(screen.getByRole("button", { name: "Select all shown" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(store.getState().comparisons.selection).toEqual([]);
  });

  it("filters by event and measuring dates (local days, both inclusive)", async () => {
    const { calls, user } = setupD12();
    await screen.findByText("camel-A");
    await user.type(screen.getByRole("textbox", { name: "Event" }), "مزاين");
    await waitFor(() => expect(calls().some((c) => c.includes("event="))).toBe(true));
    fireEvent.change(screen.getByLabelText("Measured from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("to"), { target: { value: "2026-10-17" } });
    await waitFor(() =>
      expect(calls().some((c) => c.includes("created_from=") && c.includes("created_to="))).toBe(
        true,
      ),
    );
    const last = new URL(
      `http://x${calls()
        .filter((c) => c.startsWith("GET /sessions?"))
        .at(-1)!
        .slice(4)}`,
    );
    expect(last.searchParams.get("event")).toBe("مزاين");
    expect(last.searchParams.get("created_from")).toBe(new Date(2026, 9, 1).toISOString());
    expect(last.searchParams.get("created_to")).toBe(
      new Date(2026, 9, 17, 23, 59, 59, 999).toISOString(),
    );
  });

  it("deleting a session names the comparisons that hold it", async () => {
    const { user } = setupD12();
    await screen.findByText("camel-A");
    const rowA = document.querySelector<HTMLElement>(`tr[data-session="${A}"]`)!;
    await user.click(within(rowA).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("delete-in-comparisons")).toHaveTextContent(
      "Comparisons that include it (they will be out of date): 2",
    );
  });

  it("the Comparisons tab lists the comparisons and keeps its place in the address (Arabic)", async () => {
    const { user, router, calls } = setupD12("ar");
    // the Arabic checkbox label isolates the Latin id too, so it is found twice
    await screen.findAllByText("camel-A");
    await user.click(screen.getByRole("tab", { name: "المقارنات" }));
    expect(await screen.findByText("مزاين ١")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?tab=comparisons");
    expect(calls().some((c) => c.startsWith("GET /comparisons?"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "فتح" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/comparisons/${COMPARISON_ID}`),
    );
  });

  it("opens on the Comparisons tab from the address and deletes after a confirmation", async () => {
    let deleted = 0;
    const engine = connectScriptedEngine({
      "GET /sessions": () => jsonResponse(200, { items: rows, total: 2, reconciled: {} }),
      "GET /history/stats": () => jsonResponse(200, sampleStats),
      "GET /comparisons": () =>
        jsonResponse(200, {
          items: deleted ? [] : [comparisonRow()],
          total: deleted ? 0 : 1,
          reconciled: {},
        }),
      [`DELETE /comparisons/${COMPARISON_ID}`]: () => {
        deleted += 1;
        return jsonResponse(200, { deleted: true, trashed_to: "trash/comparison_x" });
      },
    });
    renderRoutes([{ path: "/history", element: <HistoryScreen /> }], "/history?tab=comparisons", {
      preloadedState: { ...uiState("en"), engine: engineState() },
    });
    const user = userEvent.setup();
    expect(await screen.findByText("مزاين ١")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete the comparison?");
    expect(dialog).toHaveTextContent("The camels' sessions stay.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("No comparisons yet: select camels under Sessions"),
    ).toBeVisible();
    expect(deleted).toBe(1);
    expect(engine.requests.some((r) => new URL(r.url).pathname === "/sessions")).toBe(false);
  });
});
