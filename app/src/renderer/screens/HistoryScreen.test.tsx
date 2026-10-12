import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import historyFixture from "../../../fixtures/history_list.json";
import sessionFixture from "../../../fixtures/session_view.json";
import { setEngineConnection } from "@/api/connection";
import type { HistoryList } from "@/api/types";
import { sampleStats } from "@/design/samples";
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
});
