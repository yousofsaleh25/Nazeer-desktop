import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonExportResult, NazeerApi } from "@shared/ipc";
import { setEngineConnection } from "@/api/connection";
import type { ComparisonView } from "@/api/types";
import {
  comparisonMember,
  comparisonView,
  COMPARISON_ID,
  historyRow,
  SHA_A,
} from "@/test/comparisons";
import { connectScriptedEngine, engineState, jsonResponse } from "@/test/engine";
import { COMPARISONS_INITIAL } from "@/store/slices/comparisons";
import { renderRoutes, uiState } from "@/test/render";
import { ComparisonScreen } from "./ComparisonScreen";

afterEach(() => {
  setEngineConnection(null);
  delete (window as { nazeer?: unknown }).nazeer;
});

const A = "20261017_100000_aaaaaa";
const B = "20261017_100500_bbbbbb";

function setup(
  initial: ComparisonView,
  lang: "en" | "ar" = "en",
  approvals: Record<string, { version: number; sha256: string }> = {},
) {
  let view = initial;
  const patches: unknown[] = [];
  let deleted = false;
  const engine = connectScriptedEngine({
    [`GET /comparisons/${COMPARISON_ID}`]: () => jsonResponse(200, view),
    [`PATCH /comparisons/${COMPARISON_ID}/inputs`]: async (request) => {
      const body = (await request.json()) as { cover: ComparisonView["cover"]; language: "ar" };
      patches.push(body);
      view = {
        ...view,
        cover: body.cover,
        language: body.language,
        outputs: { ...view.outputs, model: { ...view.outputs.model, version: 2 } },
      };
      return jsonResponse(200, view);
    },
    [`DELETE /comparisons/${COMPARISON_ID}`]: () => {
      deleted = true;
      return jsonResponse(200, { deleted: true, trashed_to: "trash/x" });
    },
    "GET /sessions": (_request, url) => {
      const q = url.searchParams.get("q");
      const items = q === A ? [historyRow(A, "جمل-أ")] : [];
      return jsonResponse(200, { items, total: items.length, reconciled: {} });
    },
  });
  const rendered = renderRoutes(
    [{ path: "/comparisons/:id", element: <ComparisonScreen /> }],
    `/comparisons/${COMPARISON_ID}`,
    {
      preloadedState: {
        ...uiState(lang),
        engine: engineState(),
        comparisons: { ...COMPARISONS_INITIAL, approvals },
      },
    },
  );
  return { ...rendered, engine, patches, deleted: () => deleted, user: userEvent.setup() };
}

const memberRow = (id: string) => document.querySelector<HTMLElement>(`tr[data-session="${id}"]`)!;

describe("ComparisonScreen", () => {
  it("shows the cover, the camels in print order and each image's approval", async () => {
    const view = comparisonView({
      members: [
        comparisonMember(2, B, "camel-B", { approved_by_seal: true }),
        comparisonMember(1, A, "جمل-أ"),
      ],
    });
    setup(view);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("مزاين ١");
    const order = [...document.querySelectorAll("tr[data-session]")].map((tr) =>
      tr.getAttribute("data-session"),
    );
    expect(order).toEqual([A, B]);
    expect(within(memberRow(B)).getByText("Approved: in a sealed report")).toBeInTheDocument();
    expect(within(memberRow(A)).getByRole("button", { name: "Approve the image" })).toBeEnabled();
    expect(screen.getByText("not sealed yet")).toBeInTheDocument();
    expect(screen.queryByText("This comparison is out of date")).toBeNull();
    expect(screen.getByText(`v1 · ${"b".repeat(12)}…`)).toBeInTheDocument();
  });

  it("an out-of-date comparison says why per camel; a deleted camel has no session link", async () => {
    const view = comparisonView({
      stale: true,
      members: [
        comparisonMember(1, A, "جمل-أ", {
          stale_reasons: ["member_reopened"],
          current: { readable: true, status: "open", revision: 4 },
        }),
        comparisonMember(2, B, "camel-B", {
          stale_reasons: ["member_deleted"],
          current: null,
          notes: ["member_session_changed"],
        }),
      ],
    });
    setup(view);
    expect(await screen.findByText("This comparison is out of date")).toBeInTheDocument();
    expect(memberRow(A)).toHaveTextContent("this camel's session was reopened");
    expect(within(memberRow(A)).getByText("open")).toBeInTheDocument();
    expect(within(memberRow(A)).queryByRole("button", { name: "Approve the image" })).toBeNull();
    expect(memberRow(B)).toHaveTextContent("this camel's session was deleted");
    expect(memberRow(B)).toHaveTextContent("the session file changed; its measurements did not");
    expect(within(memberRow(B)).getByText("deleted")).toBeInTheDocument();
    expect(within(memberRow(B)).queryByRole("button", { name: "Open the session" })).toBeNull();
    expect(screen.getByRole("button", { name: "Compare again" })).toBeInTheDocument();
  });

  it("saves the cover and language as one change (the next comparison data version)", async () => {
    const { patches, user } = setup(comparisonView());
    const cover = await screen.findByTestId("comparison-cover");
    const save = within(cover).getByRole("button", { name: "Save the cover" });
    expect(save).toBeDisabled();
    await user.type(within(cover).getByRole("textbox", { name: "Judge" }), " الحكم ");
    await user.click(within(cover).getByRole("radio", { name: "English" }));
    await user.click(save);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      cover: { title: "مزاين ١", event: "الفعالية", judge: "الحكم", council: "" },
      language: "en",
    });
    expect(await screen.findByText(`v2 · ${"b".repeat(12)}…`)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("comparison-cover")).getByRole("button", {
        name: "Save the cover",
      }),
    ).toBeDisabled();
  });

  it("another comparison opens with its own cover, not the draft left on the one before", async () => {
    // both at model version 1: the cover form was keyed by the version alone (review, Stage 6)
    const OTHER = "20261017_120000_cccccc";
    const first = comparisonView();
    connectScriptedEngine({
      [`GET /comparisons/${COMPARISON_ID}`]: () => jsonResponse(200, first),
      [`GET /comparisons/${OTHER}`]: () =>
        jsonResponse(
          200,
          comparisonView({ comparison_id: OTHER, cover: { ...first.cover, title: "مزاين ٢" } }),
        ),
    });
    const { router } = renderRoutes(
      [{ path: "/comparisons/:id", element: <ComparisonScreen /> }],
      `/comparisons/${COMPARISON_ID}`,
      { preloadedState: { ...uiState("en"), engine: engineState() } },
    );
    const user = userEvent.setup();
    const title = within(await screen.findByTestId("comparison-cover")).getByRole("textbox", {
      name: "Title",
    });
    await user.type(title, " draft");
    expect(title).toHaveValue("مزاين ١ draft");
    await router.navigate(`/comparisons/${OTHER}`);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("comparison-cover")).getByRole("textbox", { name: "Title" }),
      ).toHaveValue("مزاين ٢"),
    );
    expect(
      within(screen.getByTestId("comparison-cover")).getByRole("button", {
        name: "Save the cover",
      }),
    ).toBeDisabled();
  });

  it("Compare again opens the dialog with the camels that can still join and names the rest (Arabic)", async () => {
    const view = comparisonView({
      stale: true,
      language: "ar",
      members: [
        comparisonMember(1, A, "جمل-أ"),
        comparisonMember(2, B, "camel-B", { stale_reasons: ["member_deleted"], current: null }),
      ],
    });
    const { user, store } = setup(view, "ar");
    await user.click(await screen.findByRole("button", { name: "إنشاء مقارنة جديدة" }));
    const dialog = await screen.findByTestId("compare-dialog");
    expect(
      [...dialog.querySelectorAll("li[data-session]")].map((li) => li.getAttribute("data-session")),
    ).toEqual([A]);
    expect(dialog).toHaveTextContent("إبل لم تُضمّ إلى المقارنة الجديدة");
    expect(dialog).toHaveTextContent("حُذفت جلسة هذا الجمل");
    expect(within(dialog).getByRole("textbox", { name: "العنوان" })).toHaveValue("مزاين ١");
    expect(store.getState().comparisons).toMatchObject({
      language: "ar",
      againFrom: COMPARISON_ID,
    });
    expect(store.getState().comparisons.selection[0]?.overlay?.sha256).toBe(SHA_A);
  });

  it("deletes after a confirmation and returns to the Comparisons tab", async () => {
    const { user, router, deleted } = setup(comparisonView());
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=comparisons"));
    expect(router.state.location.pathname).toBe("/history");
    expect(deleted()).toBe(true);
  });

  it("an unknown comparison shows the engine's error", async () => {
    connectScriptedEngine({});
    renderRoutes(
      [{ path: "/comparisons/:id", element: <ComparisonScreen /> }],
      "/comparisons/20261017_000000_000000",
      { preloadedState: { ...uiState("en"), engine: engineState() } },
    );
    expect(await screen.findByText("The comparison could not be loaded")).toBeInTheDocument();
  });

  describe("print and seal (Stage 5)", () => {
    function bridge(result: ComparisonExportResult) {
      const exportComparison = vi.fn<NazeerApi["print"]["exportComparison"]>(() =>
        Promise.resolve(result),
      );
      (window as { nazeer?: Partial<NazeerApi> }).nazeer = {
        print: { exportPdf: vi.fn(), exportComparison },
      };
      return exportComparison;
    }
    const sealed: ComparisonExportResult = {
      ok: true,
      comparison: { comparison_id: COMPARISON_ID, outputs: { report: { version: 1 } } },
      probe: { verdict: "PASS" },
      preflight: {
        ok: true,
        problems: [],
        warnings: [],
        checked: { requiredTexts: 1, textNodes: 1, characters: 1, images: 2 },
      },
      pdfBytes: 10,
      timingsMs: {},
    };

    it("waits for every image's approval, then sends the approvals given here", async () => {
      const view = comparisonView({
        members: [
          comparisonMember(1, A, "جمل-أ"),
          comparisonMember(2, B, "camel-B", { approved_by_seal: true }),
        ],
      });
      const spy = bridge(sealed);
      setup(view);
      const card = await screen.findByTestId("comparison-print");
      expect(within(card).getByRole("button", { name: "Print the comparison" })).toBeDisabled();
      expect(within(card).getByTestId("print-blocked")).toHaveTextContent(
        "Approve each camel's image before printing",
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it("prints, offers Save as for the sealed version and says it is sealed", async () => {
      const view = comparisonView({
        members: [
          comparisonMember(1, A, "جمل-أ"),
          comparisonMember(2, B, "camel-B", { approved_by_seal: true }),
        ],
      });
      const spy = bridge(sealed);
      const { user, store } = setup(view, "en", { [A]: { version: 1, sha256: SHA_A } });
      const card = await screen.findByTestId("comparison-print");
      await user.click(within(card).getByRole("button", { name: "Print the comparison" }));
      expect(await within(card).findByText("The comparison is sealed")).toBeInTheDocument();
      // the camel sealed in a report needs no approval; the one approved here names its image
      expect(spy).toHaveBeenCalledWith({
        comparisonId: COMPARISON_ID,
        model: { version: 1, sha256: "b".repeat(64) },
        approvals: [{ sessionId: A, overlayVersion: 1, sha256: SHA_A }],
      });
      expect(store.getState().savedFiles.offer).toEqual({
        kind: "comparison",
        id: COMPARISON_ID,
        version: 1,
      });
    });

    it("an out-of-date comparison or an unsaved cover blocks the print (Arabic)", async () => {
      bridge(sealed);
      const stale = comparisonView({
        members: [
          comparisonMember(1, A, "جمل-أ", {
            approved_by_seal: true,
            stale_reasons: ["member_edited"],
          }),
        ],
      });
      const first = setup(stale, "ar");
      expect(await screen.findByTestId("print-blocked")).toHaveTextContent(
        "هذه المقارنة قديمة: أنشئ مقارنة جديدة لطباعتها",
      );
      first.unmount();

      const current = comparisonView({
        members: [comparisonMember(1, A, "جمل-أ", { approved_by_seal: true })],
      });
      const { user } = setup(current, "ar");
      const card = await screen.findByTestId("comparison-print");
      expect(within(card).getByRole("button", { name: "طباعة المقارنة" })).toBeEnabled();
      await user.type(screen.getByRole("textbox", { name: "العنوان" }), " ٢");
      expect(await within(card).findByTestId("print-blocked")).toHaveTextContent(
        "احفظ الغلاف قبل الطباعة",
      );
      expect(within(card).getByRole("button", { name: "طباعة المقارنة" })).toBeDisabled();
    });

    it("a refused print shows the engine's code and its probe per camel", async () => {
      const view = comparisonView({
        members: [comparisonMember(1, A, "جمل-أ", { approved_by_seal: true })],
      });
      bridge({
        ok: false,
        error: {
          status: 409,
          code: "overlay_out_of_place",
          message: "camel #1's image is on two pages",
          details: { rejected_file: "report_v1.rejected_x.pdf" },
        },
        probe: {
          kind: "comparison",
          verdict: "DRIFT",
          hard_failures: ["overlay_out_of_place"],
          pixel: {
            ok: false,
            reasons: ["overlay_out_of_place"],
            members: [{ position: 1, ok: false, reason: "overlay_out_of_place", page: 3 }],
          },
          text: {
            ok: true,
            names: [],
            members: [{ position: 1, checked: true, ok: true, pages: [3, 4], names: [] }],
          },
        },
        preflight: null,
        timingsMs: {},
      });
      const { user } = setup(view);
      const card = await screen.findByTestId("comparison-print");
      await user.click(within(card).getByRole("button", { name: "Print the comparison" }));
      expect(await within(card).findByText("Printing failed")).toBeInTheDocument();
      const members = within(card).getByTestId("probe-members");
      expect(within(members).getByText("3–4")).toBeInTheDocument();
      expect(card).toHaveTextContent("report_v1.rejected_x.pdf");
    });
  });
});
