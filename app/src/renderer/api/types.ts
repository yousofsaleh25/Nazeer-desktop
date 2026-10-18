/**
 * Names for the engine's API schemas (generated into @shared/api from engine/openapi.json). The
 * renderer imports these instead of spelling out `components["schemas"][…]` everywhere.
 */
import type { components } from "@shared/api";

type Schemas = components["schemas"];

export type Bilingual = Schemas["Bilingual"];
export type BagInfo = Schemas["BagInfoOut"];
export type RecentBag = Schemas["RecentBag"];
export type RecentBagList = Schemas["RecentBagList"];
export type DeleteOut = Schemas["DeleteOut"];
export type CandidateItem = Schemas["CandidateItem"];
export type CandidateSet = Schemas["CandidateSet"];
export type JobSnapshot = Schemas["JobSnapshot"];
export type JobState = JobSnapshot["state"];
export type JobStage = JobSnapshot["stage"];
export type DepthOut = Schemas["DepthOut"];
export type DepthBasis = Schemas["DepthBasis"];
export type FlagChipData = Schemas["FlagChip"];
export type RejectionPart = Schemas["RejectionPart"];
export type Presentation = Schemas["Presentation"];
export type MeasurementInput = Schemas["MeasurementInputModel"];
export type InputKind = MeasurementInput["kind"];
export type MeasurementRow = Schemas["MeasurementRow"];
export type PreviewOut = Schemas["PreviewOut"];
export type RowKind = MeasurementRow["kind"];
export type SessionView = Schemas["SessionView"];
export type SessionSummary = Schemas["SessionSummary"];
export type SessionStatus = SessionView["status"];
export type FrameInfo = Schemas["FrameInfo"];
export type OverlayOutput = Schemas["OverlayOutput"];
export type ReportOutput = Schemas["ReportOutput"];
export type ReportModelOutput = Schemas["ReportModelOutput"];
export type ReportInputs = Schemas["ReportInputsOut"];
export type ReportLanguage = ReportInputs["language"];
export type RubricVariant = ReportInputs["rubric_variant"];
export type HistoryRow = Schemas["HistoryRow"];
export type HistoryList = Schemas["HistoryList"];
export type HistoryStats = Schemas["HistoryStats"];
export type BackupOut = Schemas["BackupOut"];
export type ComparisonList = Schemas["ComparisonList"];
export type ComparisonRow = Schemas["ComparisonRow"];
export type ComparisonView = Schemas["ComparisonView"];
export type ComparisonMember = Schemas["ComparisonMember"];
export type ComparisonCreateIn = Schemas["ComparisonCreateIn"];
export type ComparisonInputsIn = Schemas["ComparisonInputsIn"];
export type StaleReason = ComparisonMember["stale_reasons"][number];
export type Health = Schemas["Health"];
export type ErrorDetail = Schemas["ErrorDetail"];
export type Target = DepthOut["target"];

/** The eight kinds the operator picks from, in toolbar order (shortcuts 1–8). */
export const INPUT_KINDS: readonly InputKind[] = [
  "distance_2d",
  "distance_3d",
  "curve_2d",
  "curve_3d",
  "angle_2d_3point",
  "angle_3d_3point",
  "angle_2d_from_horizontal",
  "angle_4point",
];
