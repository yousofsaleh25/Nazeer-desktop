/**
 * The engine payloads captured in app/fixtures by scripts/capture-fixtures.mjs (a real bag-006
 * session and its candidate set, served by the engine with the stub model), typed with the API
 * types. Used by the /design gallery and the tests only; JSON imports widen string unions, hence
 * the casts.
 */
import candidateSet from "../../../fixtures/candidate_set.json";
import depthGround from "../../../fixtures/depth_ground.json";
import depthInside from "../../../fixtures/depth_inside.json";
import depthOutsideKnn from "../../../fixtures/depth_outside_knn.json";
import error401 from "../../../fixtures/error_401_unauthorized.json";
import error404 from "../../../fixtures/error_404_session.json";
import error409 from "../../../fixtures/error_409_stale_revision.json";
import error422 from "../../../fixtures/error_422_validation.json";
import health from "../../../fixtures/health.json";
import historyList from "../../../fixtures/history_list.json";
import labels from "../../../fixtures/labels.json";
import meta from "../../../fixtures/_meta.json";
import angle2d3 from "../../../fixtures/preview_angle_2d_3point.json";
import angle3d3 from "../../../fixtures/preview_angle_3d_3point.json";
import angleHorizontal from "../../../fixtures/preview_angle_2d_from_horizontal.json";
import angle4 from "../../../fixtures/preview_angle_4point_2d.json";
import angle4Mixed from "../../../fixtures/preview_angle_4point_mixed.json";
import previewRejected from "../../../fixtures/preview_rejected.json";
import probePass from "../../../fixtures/probe_pass.json";
import recentBags from "../../../fixtures/recent_bags.json";
import reportModel from "../../../fixtures/report_model.json";
import sessionView from "../../../fixtures/session_view.json";
import versions from "../../../fixtures/versions.json";
import { errorFromResponse } from "@/api/errors";
import { parseLabels } from "@/api/labels";
import type {
  CandidateSet,
  DepthOut,
  Health,
  HistoryList,
  MeasurementRow,
  PreviewOut,
  RecentBag,
  SessionView,
} from "@/api/types";

const as = <T>(value: unknown) => value as T;

export const fixtures = {
  meta,
  health: as<Health>(health),
  versions: as<Record<string, string | null>>(versions),
  labels: parseLabels(labels),
  recentBags: as<{ items: RecentBag[]; total: number }>(recentBags),
  historyList: as<HistoryList>(historyList),
  sessionView: as<SessionView>(sessionView),
  candidateSet: as<CandidateSet>(candidateSet),
  reportModel: reportModel as unknown,
  depth: {
    inside: as<DepthOut>(depthInside),
    outsideKnn: as<DepthOut>(depthOutsideKnn),
    ground: as<DepthOut>(depthGround),
  },
  preview: {
    rejected: as<PreviewOut>(previewRejected),
    angle2d3: as<PreviewOut>(angle2d3),
    angle3d3: as<PreviewOut>(angle3d3),
    angleHorizontal: as<PreviewOut>(angleHorizontal),
    angle4: as<PreviewOut>(angle4),
    angle4Mixed: as<PreviewOut>(angle4Mixed),
  },
  errors: {
    unauthorized: errorFromResponse(401, error401),
    notFound: errorFromResponse(404, error404),
    validation: errorFromResponse(422, error422),
    staleRevision: errorFromResponse(409, error409),
  },
  probePass: probePass as unknown,
};

/** The session's nine saved rows (2D/3D distances, a KNN point, a ground point, two curves). */
export const sessionRows: MeasurementRow[] = fixtures.sessionView.measurements;

/** Every kind the engine computes: the session rows plus the preview rows (angles, a rejection). */
export function allKindRows(): MeasurementRow[] {
  const p = fixtures.preview;
  return [
    ...sessionRows,
    { ...p.angle2d3.row, id: 10 },
    { ...p.angle3d3.row, id: 11 },
    { ...p.angleHorizontal.row, id: 12 },
    { ...p.angle4.row, id: 13 },
    { ...p.angle4Mixed.row, id: 14 },
    { ...p.rejected.row, id: 15 },
  ];
}
