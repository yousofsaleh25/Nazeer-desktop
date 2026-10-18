import { describe, expect, it } from "vitest";
import { comparisonMember, historyRow, SHA_A, SHA_B } from "@/test/comparisons";
import {
  approvalOf,
  compareAgainPrepared,
  compareDialogOpened,
  comparisonCreated,
  comparisonExportFinished,
  comparisonExportStarted,
  comparisonsParams,
  comparisonsQueryChanged,
  comparisonsReducer,
  COMPARISONS_INITIAL,
  coverBody,
  exportApprovals,
  memberApproved,
  memberFromRow,
  memberMoved,
  memberRemoved,
  membersAdded,
  memberToggled,
  readyToCreate,
  selectionCleared,
  selectionRowsSeen,
  sharedEvent,
  type ComparisonsState,
} from "./comparisons";

const a = memberFromRow(historyRow("20261017_100000_aaaaaa", "A", { event: "E" }));
const b = memberFromRow(historyRow("20261017_100100_bbbbbb", "B", { sealed: true, event: "E" }));
const c = memberFromRow(historyRow("20261017_100200_cccccc", "C", { event: "F" }));
const open = memberFromRow(historyRow("20261017_100300_dddddd", "D", { eligible: false }));

function run(...actions: Parameters<typeof comparisonsReducer>[1][]): ComparisonsState {
  return actions.reduce(comparisonsReducer, COMPARISONS_INITIAL);
}
const ids = (state: ComparisonsState) => state.selection.map((m) => m.camelId);

describe("comparisons slice", () => {
  it("takes a History row's eligibility and image as the engine sent them", () => {
    expect(a).toMatchObject({ eligible: true, reason: null, approvedBySeal: false });
    expect(a.overlay).toEqual({
      version: 1,
      sha256: SHA_A,
      url: `/sessions/${a.sessionId}/assets/overlay_v1.png`,
    });
    expect(b.approvedBySeal).toBe(true);
    expect(open).toMatchObject({ eligible: false, reason: "not_finalized", overlay: null });
  });

  it("ticks in the operator's order, never an ineligible camel, never past the maximum", () => {
    let state = run(
      memberToggled({ member: c, max: 2 }),
      memberToggled({ member: a, max: 2 }),
      memberToggled({ member: open, max: 2 }),
      memberToggled({ member: b, max: 2 }),
    );
    expect(ids(state)).toEqual(["C", "A"]);
    state = comparisonsReducer(state, memberToggled({ member: c, max: 2 }));
    expect(ids(state)).toEqual(["A"]);
    // no maximum known: the engine still refuses beyond its own
    expect(ids(run(...[a, b, c].map((member) => memberToggled({ member, max: null }))))).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("'select all shown' adds the eligible camels not picked yet, in list order, up to the maximum", () => {
    const state = run(
      memberToggled({ member: b, max: 3 }),
      membersAdded({ members: [a, open, b, c], max: 3 }),
    );
    expect(ids(state)).toEqual(["B", "A", "C"]);
    expect(ids(run(membersAdded({ members: [a, b, c], max: 2 })))).toEqual(["A", "B"]);
  });

  it("moves a camel (drag or the arrows) and removes one; the last removal closes the dialog", () => {
    let state = run(membersAdded({ members: [a, b, c], max: null }));
    state = comparisonsReducer(state, memberMoved({ sessionId: c.sessionId, to: 0 }));
    expect(ids(state)).toEqual(["C", "A", "B"]);
    state = comparisonsReducer(state, memberMoved({ sessionId: c.sessionId, to: 99 }));
    expect(ids(state)).toEqual(["A", "B", "C"]);
    state = comparisonsReducer(state, memberMoved({ sessionId: "nope", to: 0 }));
    expect(ids(state)).toEqual(["A", "B", "C"]);
    state = run(memberToggled({ member: a, max: null }), compareDialogOpened());
    expect(state.dialogOpen).toBe(true);
    state = comparisonsReducer(state, memberRemoved(a.sessionId));
    expect(state).toMatchObject({ selection: [], dialogOpen: false });
  });

  it("a list refreshes the picked camels it shows (one reopened turns ineligible)", () => {
    const reopened = memberFromRow(
      historyRow(a.sessionId, "A", { eligible: false, reason: "reopened" }),
    );
    const state = run(
      membersAdded({ members: [a, b], max: null }),
      selectionRowsSeen([reopened, c]),
    );
    expect(state.selection).toEqual([reopened, b]);
    expect(readyToCreate(state, 20)).toBe(false);
  });

  it("an approval names the image's version and SHA-256; a new image needs a new approval", () => {
    expect(approvalOf({}, b)).toBe("seal");
    expect(approvalOf({}, a)).toBe("needed");
    const state = run(memberApproved({ sessionId: a.sessionId, version: 1, sha256: SHA_A }));
    expect(approvalOf(state.approvals, a)).toBe("approved");
    expect(approvalOf(state.approvals, { ...a, overlay: { ...a.overlay!, sha256: SHA_B } })).toBe(
      "needed",
    );
    expect(approvalOf(state.approvals, { ...a, overlay: { ...a.overlay!, version: 2 } })).toBe(
      "needed",
    );
  });

  it("is ready to create once every camel is eligible and approved, within the maximum", () => {
    let state = run(membersAdded({ members: [a, b], max: null }));
    expect(readyToCreate(state, 20)).toBe(false);
    state = comparisonsReducer(
      state,
      memberApproved({ sessionId: a.sessionId, version: 1, sha256: SHA_A }),
    );
    expect(readyToCreate(state, 20)).toBe(true);
    expect(readyToCreate(state, 1)).toBe(false);
    expect(readyToCreate(COMPARISONS_INITIAL, 20)).toBe(false);
  });

  it("a fresh dialog starts from the event every camel shares", () => {
    expect(sharedEvent([a, b])).toBe("E");
    expect(sharedEvent([a, c])).toBe("");
    const state = run(membersAdded({ members: [a, b], max: null }), compareDialogOpened());
    expect(state.cover).toEqual({ title: "", event: "E", judge: "", council: "" });
    // nothing picked: the dialog stays closed
    expect(run(compareDialogOpened()).dialogOpen).toBe(false);
  });

  it("creating clears the picks and the cover; the approvals stay for printing", () => {
    const state = run(
      membersAdded({ members: [a, b], max: null }),
      memberApproved({ sessionId: a.sessionId, version: 1, sha256: SHA_A }),
      compareDialogOpened(),
      comparisonCreated(),
    );
    expect(state).toMatchObject({ selection: [], dialogOpen: false, againFrom: null });
    expect(state.approvals[a.sessionId]).toEqual({ version: 1, sha256: SHA_A });
  });

  it("'Compare again' brings its order, cover and language and keeps them when the dialog opens", () => {
    const cover = { title: "T", event: "Ev", judge: "J", council: "C" };
    let state = run(
      compareAgainPrepared({
        from: "x",
        members: [c, a],
        cover,
        language: "ar",
        dropped: [
          { sessionId: "s", camelId: "D", group: "comparison_stale", reason: "member_deleted" },
        ],
      }),
    );
    expect(state).toMatchObject({ dialogOpen: true, cover, language: "ar", againFrom: "x" });
    expect(ids(state)).toEqual(["C", "A"]);
    state = comparisonsReducer(state, compareDialogOpened());
    expect(state.cover).toEqual(cover);
    state = comparisonsReducer(state, selectionCleared());
    expect(state).toMatchObject({ selection: [], againFrom: null, dropped: [] });
  });

  it("builds the engine's bodies: the cover trimmed only, the list query", () => {
    expect(coverBody({ title: "  مزاين  ", event: " E", judge: "", council: "C " })).toEqual({
      title: "مزاين",
      event: "E",
      judge: "",
      council: "C",
    });
    const state = run(comparisonsQueryChanged({ q: "  جمل ", stale: true, status: "sealed" }));
    expect(comparisonsParams(state.query)).toEqual({
      q: "جمل",
      status: "sealed",
      stale: true,
      sort: "created_desc",
      limit: 50,
      offset: 0,
    });
    expect(comparisonsParams(COMPARISONS_INITIAL.query)).toMatchObject({
      q: undefined,
      status: undefined,
      stale: undefined,
    });
  });

  it("the print sends the approvals given here; a camel sealed in a report needs none (Stage 5)", () => {
    const A = "20261017_100000_aaaaaa";
    const B = "20261017_100500_bbbbbb";
    const members = [
      comparisonMember(1, A, "A"),
      comparisonMember(2, B, "B", { approved_by_seal: true }),
    ];
    expect(exportApprovals({}, members)).toBeNull();
    // an approval of another image of A is not this one
    expect(exportApprovals({ [A]: { version: 1, sha256: SHA_B } }, members)).toBeNull();
    expect(exportApprovals({ [A]: { version: 1, sha256: SHA_A } }, members)).toEqual([
      { sessionId: A, overlayVersion: 1, sha256: SHA_A },
    ]);
  });

  it("keeps the last print of a comparison; a late answer for another one is ignored", () => {
    const done = {
      ok: true,
      error: null,
      probe: { verdict: "PASS" },
      preflight: null,
      timingsMs: {},
    };
    const state = run(
      comparisonExportStarted("c1"),
      comparisonExportFinished({ comparisonId: "c0", ...done }),
    );
    expect(state.export).toMatchObject({ comparisonId: "c1", state: "printing" });
    const sealed = run(
      comparisonExportStarted("c1"),
      comparisonExportFinished({ comparisonId: "c1", ...done }),
    );
    expect(sealed.export).toMatchObject({
      comparisonId: "c1",
      state: "sealed",
      probe: { verdict: "PASS" },
    });
  });
});
