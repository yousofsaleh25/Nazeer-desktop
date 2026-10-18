import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setEngineConnection } from "@/api/connection";
import { COMPARISONS_INITIAL, memberApproved, memberFromRow } from "@/store/slices/comparisons";
import { comparisonView, historyRow } from "@/test/comparisons";
import { connectScriptedEngine, errorResponse, jsonResponse } from "@/test/engine";
import { renderRoutes, uiState } from "@/test/render";
import { OVERLAY_BYTES, sha256Hex } from "@/test/sessionEngine";
import { CompareDialog } from "./CompareDialog";

afterEach(() => setEngineConnection(null));

const A = "20261017_100000_aaaaaa";
const B = "20261017_100500_bbbbbb";

async function setup(lang: "en" | "ar", create?: (body: unknown) => Response) {
  const sha = await sha256Hex(OVERLAY_BYTES);
  const posted: unknown[] = [];
  const engine = connectScriptedEngine({
    [`GET /sessions/${A}/assets/overlay_v1.png`]: () =>
      new Response(OVERLAY_BYTES, { status: 200, headers: { "Content-Type": "image/png" } }),
    "POST /comparisons": async (request) => {
      const body: unknown = await request.json();
      posted.push(body);
      return (
        create?.(body) ??
        jsonResponse(201, comparisonView({ comparison_id: "20261017_130000_c0ffee" }))
      );
    },
  });
  const a = memberFromRow(historyRow(A, "camel-A", { sha256: sha, event: "Ev" }));
  const b = memberFromRow(historyRow(B, "جمل-ب", { sealed: true, event: "Ev" }));
  const view = renderRoutes([{ path: "/history", element: <CompareDialog /> }], "/history", {
    preloadedState: {
      ...uiState(lang),
      comparisons: {
        ...COMPARISONS_INITIAL,
        selection: [a, b],
        dialogOpen: true,
        cover: { title: "", event: "Ev", judge: "", council: "" },
      },
    },
  });
  const dialog = () => within(screen.getByTestId("compare-dialog"));
  const order = () =>
    [...screen.getByTestId("compare-dialog").querySelectorAll("li[data-session]")].map((li) =>
      li.getAttribute("data-session"),
    );
  return { ...view, engine, posted, dialog, order, sha, user: userEvent.setup() };
}

describe("CompareDialog", () => {
  it("orders, approves the unsealed image on the engine's full image, then creates", async () => {
    const { dialog, order, posted, router, store, sha, user } = await setup("en");
    expect(order()).toEqual([A, B]);
    expect(dialog().getByText("Approved: in a sealed report")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create the comparison" });
    expect(create).toBeDisabled();
    expect(screen.getByText("Approve every image that no sealed report shows yet.")).toBeVisible();

    // the arrows move a camel; the first cannot go up
    const first = within(
      screen.getByTestId("compare-dialog").querySelector(`li[data-session="${A}"]`)!,
    );
    expect(first.getByRole("button", { name: "Move up" })).toBeDisabled();
    await user.click(first.getByRole("button", { name: "Move down" }));
    expect(order()).toEqual([B, A]);

    await user.click(dialog().getByRole("button", { name: "Approve the image" }));
    const approval = await screen.findByTestId("member-approval");
    expect(await within(approval).findByText("Fingerprint verified")).toBeInTheDocument();
    await user.click(within(approval).getByRole("button", { name: "Approve this image" }));
    await waitFor(() => expect(screen.queryByTestId("member-approval")).toBeNull());
    expect(store.getState().comparisons.approvals[A]).toEqual({ version: 1, sha256: sha });
    expect(dialog().getByText("Approved")).toBeInTheDocument();

    await user.type(dialog().getByRole("textbox", { name: "Title" }), "  مزاين اليوم ");
    await user.click(dialog().getByRole("radio", { name: "Arabic" }));
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/comparisons/20261017_130000_c0ffee"),
    );
    expect(posted).toEqual([
      {
        session_ids: [B, A],
        cover: { title: "مزاين اليوم", event: "Ev", judge: "", council: "" },
        language: "ar",
      },
    ]);
    expect(store.getState().comparisons.selection).toEqual([]);
  });

  it("a refused create names every camel the engine refused, and stays open (Arabic)", async () => {
    const { user, store, sha } = await setup("ar", () =>
      errorResponse(409, "comparison_member_not_final", {
        members: [{ position: 2, session_id: B, reason: "reopened", not_found: false }],
      }),
    );
    // B is sealed; approve A by hand through the store to reach Create quickly
    store.dispatch(memberApproved({ sessionId: A, version: 1, sha256: sha }));
    expect(screen.getByRole("dialog", { name: "مقارنة الإبل" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إنشاء المقارنة" }));
    const refused = await screen.findByTestId("compare-refused");
    expect(refused).toHaveTextContent(B);
    expect(refused).toHaveTextContent("أُعيد فتحها بعد الإقفال: أقفلها من جديد");
    expect(screen.getByRole("alert")).toHaveAttribute("data-code", "comparison_member_not_final");
    expect(store.getState().comparisons.dialogOpen).toBe(true);
    expect(store.getState().comparisons.selection).toHaveLength(2);
  });

  it("removing every camel closes the dialog", async () => {
    const { dialog, user, store } = await setup("en");
    await user.click(dialog().getAllByRole("button", { name: "Remove from the comparison" })[0]!);
    await user.click(dialog().getAllByRole("button", { name: "Remove from the comparison" })[0]!);
    expect(store.getState().comparisons).toMatchObject({ selection: [], dialogOpen: false });
    await waitFor(() => expect(screen.queryByTestId("compare-dialog")).toBeNull());
  });
});
