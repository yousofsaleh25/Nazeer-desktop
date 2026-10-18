/**
 * Comparison payloads for component tests (D12): History rows that may or may not join a
 * comparison, comparison rows and views, shaped as the engine sends them (the captured History row
 * of app/fixtures, its eligibility replaced; the rest written from the OpenAPI schema).
 */
import historyFixture from "../../../fixtures/history_list.json";
import type { ComparisonMember, ComparisonRow, ComparisonView, HistoryRow } from "@/api/types";

const base = (historyFixture as unknown as { items: HistoryRow[] }).items[0]!;

export const SHA_A = "a".repeat(64);
export const SHA_B = "b".repeat(64);

/** A finalized History row; `eligible` rows carry an image to approve (sealed or not). */
export function historyRow(
  id: string,
  camelId: string,
  {
    eligible = true,
    reason = null,
    sealed = false,
    sha256 = SHA_A,
    event = "",
    nComparisons = 0,
  }: {
    eligible?: boolean;
    reason?: HistoryRow["comparison"]["reason"];
    sealed?: boolean;
    sha256?: string;
    event?: string;
    nComparisons?: number;
  } = {},
): HistoryRow {
  return {
    ...base,
    session_id: id,
    camel_id: camelId,
    status: eligible ? (sealed ? "exported" : "finalized") : "open",
    event,
    n_comparisons: nComparisons,
    report_version: sealed ? 1 : 0,
    session_url: `/sessions/${id}`,
    thumb_url: null,
    comparison: {
      eligible,
      reason: eligible ? null : (reason ?? "not_finalized"),
      approved_by_seal: eligible && sealed,
      overlay: eligible
        ? { version: 1, sha256, url: `/sessions/${id}/assets/overlay_v1.png` }
        : null,
    },
  };
}

export function comparisonMember(
  position: number,
  id: string,
  camelId: string,
  change: Partial<ComparisonMember> = {},
): ComparisonMember {
  return {
    position,
    session_id: id,
    camel_id: camelId,
    revision: 3,
    status_at_creation: "finalized",
    current: { readable: true, status: "finalized", revision: 3 },
    stale_reasons: [],
    notes: [],
    approved_by_seal: false,
    overlay: {
      version: 1,
      file: "overlay_v1.png",
      sha256: SHA_A,
      width: null,
      height: null,
      url: `/sessions/${id}/assets/overlay_v1.png`,
    },
    report_model: { file: "report_model_v1.json", version: 1, sha256: SHA_B },
    session_url: `/sessions/${id}`,
    ...change,
  };
}

export const COMPARISON_ID = "20261017_120000_abcdef";

export function comparisonView(change: Partial<ComparisonView> = {}): ComparisonView {
  const members = change.members ?? [
    comparisonMember(1, "20261017_100000_aaaaaa", "جمل-أ"),
    comparisonMember(2, "20261017_100500_bbbbbb", "camel-B"),
  ];
  return {
    comparison_id: COMPARISON_ID,
    status: "created",
    language: "both",
    cover: { title: "مزاين ١", event: "الفعالية", judge: "", council: "" },
    created_at: "2026-10-17T12:00:00+00:00",
    updated_at: "2026-10-17T12:00:00+00:00",
    n_members: members.length,
    members,
    stale: members.some((m) => m.stale_reasons.length > 0),
    report_stale: false,
    outputs: {
      model: {
        version: 1,
        file: "comparison_model_v1.json",
        sha256: SHA_B,
        url: `/comparisons/${COMPARISON_ID}/assets/comparison_model_v1.json`,
      },
      report: null,
      manifest_url: null,
    },
    required_report_texts: [],
    versions: {},
    index_state: "ok",
    ...change,
  };
}

export function comparisonRow(change: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    comparison_id: COMPARISON_ID,
    title: "مزاين ١",
    event: "الفعالية",
    judge: "",
    council: "",
    language: "both",
    status: "created",
    created_at: "2026-10-17T12:00:00+00:00",
    updated_at: "2026-10-17T12:00:00+00:00",
    n_members: 2,
    model_version: 1,
    report_version: 0,
    report_stale: false,
    index_state: "ok",
    index_error: "",
    members: [
      { position: 2, session_id: "20261017_100500_bbbbbb", camel_id: "camel-B", stale_reasons: [] },
      { position: 1, session_id: "20261017_100000_aaaaaa", camel_id: "جمل-أ", stale_reasons: [] },
    ],
    stale: false,
    comparison_url: `/comparisons/${COMPARISON_ID}`,
    report_url: null,
    ...change,
  };
}
