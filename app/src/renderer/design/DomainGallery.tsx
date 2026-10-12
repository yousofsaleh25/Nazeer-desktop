/**
 * /design/domain (development builds only): the operator components on real data — the engine
 * payloads in app/fixtures and the files of the dev data root's session (runs/dev_root: the frame,
 * its mask, the engine's overlay PNG and the sealed PDF, fetched through the Vite dev server and
 * checked against the engine's SHA-256 stamps with WebCrypto, as the app will do). Hand-made
 * states (a running walk, a DRIFT probe, …) come from design/samples.ts.
 */
import { useEffect, useMemo, useState } from "react";
import type { ApiErrorShape } from "@/api/errors";
import { errorFromResponse, networkError } from "@/api/errors";
import { labelOf } from "@/api/labels";
import { reportFormContent } from "@/api/reportModel";
import type { InputKind, ReportInputs } from "@/api/types";
import { AppShell } from "@/components/domain/AppShell";
import { BagPicker } from "@/components/domain/BagPicker";
import { BagSummaryCard } from "@/components/domain/BagSummaryCard";
import { CamelIdDialog } from "@/components/domain/CamelIdDialog";
import { CandidateGrid } from "@/components/domain/CandidateGrid";
import { EngineFatalPanel, EngineWaiting, engineBanners } from "@/components/domain/EngineGate";
import { EngineStatusPill } from "@/components/domain/EngineStatusPill";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { HistoryAdminPanel } from "@/components/domain/HistoryAdminPanel";
import { HistoryTable } from "@/components/domain/HistoryTable";
import { HoverReadout } from "@/components/domain/HoverReadout";
import { JobProgress } from "@/components/domain/JobProgress";
import { depthBoxOf, groundLineOf } from "@/components/domain/measure/geometry";
import { MeasureCanvas, type Viewport } from "@/components/domain/measure/MeasureCanvas";
import { itemsOfRows, MeasurementList } from "@/components/domain/MeasurementList";
import { MeasureToolbar, type CanvasLayers } from "@/components/domain/MeasureToolbar";
import { NamePrompt } from "@/components/domain/NamePrompt";
import { OverlayApproval, type OverlayVerification } from "@/components/domain/OverlayApproval";
import { PdfViewer } from "@/components/domain/PdfViewer";
import { ProbeReport } from "@/components/domain/ProbeReport";
import { ReportInputsForm } from "@/components/domain/ReportInputsForm";
import { UnsavedBadge, type SaveState } from "@/components/domain/UnsavedBadge";
import { ZRefCard } from "@/components/domain/ZRefCard";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { messagePair, useT } from "@/i18n/t";
import { sha256Hex } from "@/lib/sha256";
import { devAssetUrl } from "./devAssets";
import { allKindRows, fixtures } from "./fixtures";
import { GallerySection as Section, GalleryShell } from "./GalleryShell";
import {
  sampleBag,
  sampleConnection,
  sampleHistoryRows,
  sampleJobs,
  sampleProbeDrift,
  sampleScan,
  sampleStats,
} from "./samples";

const view = fixtures.sessionView;
const overlay = view.outputs.overlay!;
const report = view.outputs.report!;
const SAVE_STATES: SaveState[] = [
  "clean",
  "dirty",
  "saving",
  "error",
  "offline",
  "blocked",
  "conflict",
  "finalizing",
];

/** Bytes from the dev data root, checked against the engine's SHA-256 stamp. */
type Fetched =
  | { state: "verifying" }
  | { state: "match" | "mismatch"; bytes: Uint8Array<ArrayBuffer>; computed: string }
  | { state: "error"; error: ApiErrorShape };

function useVerifiedBytes(url: string, expected: string): Fetched {
  const [result, setResult] = useState<Fetched>({ state: "verifying" });
  useEffect(() => {
    let alive = true;
    const fail = (error: ApiErrorShape) => {
      if (alive) setResult({ state: "error", error });
    };
    fetch(url).then(
      async (response) => {
        if (!response.ok) return fail(errorFromResponse(response.status, null));
        const bytes = new Uint8Array(await response.arrayBuffer());
        const computed = await sha256Hex(bytes);
        if (alive)
          setResult({ state: computed === expected ? "match" : "mismatch", bytes, computed });
      },
      (error: unknown) => fail(networkError(error)),
    );
    return () => {
      alive = false;
    };
  }, [url, expected]);
  return result;
}

function useObjectUrl(bytes: Uint8Array<ArrayBuffer> | null, type: string): string | null {
  const url = useMemo(
    () => (bytes ? URL.createObjectURL(new Blob([bytes], { type })) : null),
    [bytes, type],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function viewportFor(zoom: number, center: [number, number]): Viewport {
  const { width: w, height: h } = view.frame;
  const vw = w / zoom;
  const vh = h / zoom;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp(center[0] - vw / 2, w - vw),
    y: clamp(center[1] - vh / 2, h - vh),
    width: vw,
    height: vh,
  };
}

export default function DomainGallery() {
  const t = useT();
  const [tool, setTool] = useState<InputKind | null>("curve_3d");
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState<CanvasLayers>({ mask: true, depthBox: true, labels: true });
  const [selected, setSelected] = useState<number | null>(9);
  const [dialog, setDialog] = useState(false);
  const [approved, setApproved] = useState<{ version: number; sha256: string } | null>(null);
  const [inputs, setInputs] = useState<ReportInputs>(view.report_inputs);
  const content = useMemo(() => reportFormContent(fixtures.reportModel), []);
  const rows = useMemo(() => allKindRows(), []);

  const overlayBytes = useVerifiedBytes(devAssetUrl(overlay.url), overlay.sha256);
  const pdfBytes = useVerifiedBytes(devAssetUrl(report.url), report.sha256 ?? "");
  const overlayUrl = useObjectUrl(
    overlayBytes.state === "match" ? overlayBytes.bytes : null,
    "image/png",
  );
  const verification: OverlayVerification =
    overlayBytes.state === "match" && overlayUrl !== null
      ? { state: "match", computed: overlayBytes.computed, imageUrl: overlayUrl }
      : overlayBytes.state === "mismatch"
        ? { state: "mismatch", computed: overlayBytes.computed }
        : overlayBytes.state === "error"
          ? overlayBytes
          : { state: "verifying" };

  return (
    <GalleryShell title="design.domainTitle" intro="design.domainIntro">
      <Section title="design.d.shell">
        <AppShell
          engine={{ status: "ready", connection: sampleConnection, restarts: 0 }}
          banner={<Alert tone="warning" title={messagePair("engine.stubModel")} />}
          className="min-h-0 overflow-hidden rounded-lg border border-border"
        >
          <p className="p-5 text-sm text-ink-secondary">
            <Bi {...messagePair("design.demo.canvasArea")} />
          </p>
        </AppShell>
      </Section>

      <Section title="design.d.status">
        <div className="flex flex-wrap gap-2">
          {(["starting", "ready", "restarting", "stopping", "fatal"] as const).map((status) => (
            <EngineStatusPill
              key={status}
              status={status}
              connection={status === "ready" ? sampleConnection : null}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SAVE_STATES.map((state) => (
            <UnsavedBadge key={state} state={state} revision={view.revision} />
          ))}
        </div>
      </Section>

      <Section title="design.d.engine">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex rounded-lg border border-border">
            <EngineWaiting status="starting" />
          </div>
          <div className="flex rounded-lg border border-border">
            <EngineWaiting status="restarting" restarts={2} />
          </div>
        </div>
        <EngineFatalPanel
          fatal={{
            code: "engine_already_running",
            message: "another engine is serving this data root",
            details: { pid: 36760, port: 51234, holder: "ours" },
            exitCode: 6,
          }}
          onRetry={() => {}}
          onOpenLogs={() => {}}
          onQuit={() => {}}
        />
        <EngineFatalPanel
          fatal={{
            code: "model_hash_mismatch",
            message: "model sha256 does not match the pinned hash",
            details: { model: "best.pt" },
            exitCode: 3,
          }}
          onRetry={() => {}}
          onOpenLogs={() => {}}
          onQuit={() => {}}
        />
        <div className="flex flex-col gap-2">
          {engineBanners({
            connection: { ...sampleConnection, arabicStackOk: false },
            unresponsive: true,
            labelsFailed: true,
            onRetryLabels: () => {},
          })}
        </div>
      </Section>

      <Section title="design.d.errors">
        <div className="grid gap-3 lg:grid-cols-2">
          <ErrorPanel error={fixtures.errors.notFound} onRetry={() => {}} />
          <ErrorPanel error={fixtures.errors.staleRevision} />
          <ErrorPanel
            error={fixtures.errors.validation}
            context={messagePair("session.startTitle")}
          />
          <ErrorPanel error={networkError(new TypeError("Failed to fetch"))} onRetry={() => {}} />
          <ErrorPanel
            error={{
              status: 500,
              code: "brand_new_code",
              message: "an engine code the app does not know yet",
              details: {},
            }}
          />
        </div>
      </Section>

      <Section title="design.d.bag">
        <div className="grid gap-4 lg:grid-cols-2">
          <BagPicker
            recent={[
              ...fixtures.recentBags.items,
              {
                ...fixtures.recentBags.items[0]!,
                path: "D:\\captures\\old\\20260301_101010-001.bag",
                name: "20260301_101010-001.bag",
                exists: false,
              },
            ]}
            scan={{ state: "done", result: sampleScan }}
            onBrowse={() => {}}
            onOpen={() => {}}
            onForget={() => {}}
            onScan={() => {}}
            onConfigureFolders={() => {}}
          />
          <BagSummaryCard bag={sampleBag} />
        </div>
      </Section>

      <Section title="design.d.job">
        <div className="grid gap-4 lg:grid-cols-2">
          <JobProgress
            job={sampleJobs.running}
            transport="sse"
            onStop={() => {}}
            onCancel={() => {}}
          />
          <JobProgress
            job={sampleJobs.slowMedia}
            transport="poll"
            onStop={() => {}}
            onCancel={() => {}}
          />
          <JobProgress job={sampleJobs.failed} />
          <JobProgress
            job={sampleJobs.done}
            actions={
              <Button variant="primary">
                <Bi {...messagePair("candidate.pick")} />
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="design.d.candidates">
        <CandidateGrid
          set={fixtures.candidateSet}
          assetUrl={devAssetUrl}
          selectedId={view.frame.candidate["candidate_id"] as string}
          onPick={() => setDialog(true)}
        />
      </Section>

      <Section title="design.d.session">
        <div>
          <Button variant="primary" onClick={() => setDialog(true)}>
            <Bi {...messagePair("session.startTitle")} />
          </Button>
        </div>
        <CamelIdDialog
          open={dialog}
          onOpenChange={setDialog}
          candidate={fixtures.candidateSet.candidates[5] ?? null}
          initial={{ camel_id: view.camel_id, operator: view.operator }}
          onSubmit={() => setDialog(false)}
        />
      </Section>

      <Section title="design.d.measure">
        <Alert tone="info" title={messagePair("design.demo.editingView")} />
        <MeasureToolbar
          tool={tool}
          onToolChange={setTool}
          canUndo
          canRedo={false}
          onUndo={() => {}}
          onRedo={() => {}}
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(8, z * 1.5))}
          onZoomOut={() => setZoom((z) => Math.max(1, z / 1.5))}
          onZoomReset={() => setZoom(1)}
          layers={layers}
          onLayersChange={setLayers}
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="flex flex-col gap-3">
            <MeasureCanvas
              label={t("design.demo.editingView")}
              frame={{
                width: view.frame.width,
                height: view.frame.height,
                imageUrl: devAssetUrl(view.frame.assets.rgb),
                maskUrl: devAssetUrl(view.frame.assets.mask),
                ground: groundLineOf(view.frame),
                depthBox: depthBoxOf(view.frame),
              }}
              rows={rows}
              selectedId={selected}
              viewport={viewportFor(zoom, [600, 420])}
              layers={layers}
              draft={{
                kind: "curve_3d",
                points: [
                  [905, 255],
                  [985, 300],
                ],
                targets: ["camel", "camel"],
              }}
              crosshair={{ at: [1040, 380], target: "camel" }}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <HoverReadout depth={fixtures.depth.inside} />
              <HoverReadout depth={fixtures.depth.outsideKnn} />
              <HoverReadout depth={fixtures.depth.ground} tool2d />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <ZRefCard frame={view.frame} summary={view.summary} />
            <Card title={messagePair("measure.name")}>
              <NamePrompt
                kindLabel={
                  labelOf(fixtures.labels, "input_kinds", tool) ?? {
                    ar: tool ?? "",
                    en: tool ?? "",
                  }
                }
                onSubmit={() => {}}
                onCancel={() => {}}
              />
            </Card>
            <MeasurementList
              items={[
                ...itemsOfRows(rows, { 10: "preview" }),
                {
                  input: { ...rows[0]!.input, id: 99, name: t("design.demo.notComputed") },
                  row: null,
                  status: "pending",
                },
              ]}
              summary={view.summary}
              selectedId={selected}
              onSelect={setSelected}
              onRename={() => {}}
              onEditNote={() => {}}
              onRecolor={() => {}}
              onMove={() => {}}
              onDelete={() => {}}
            />
          </div>
        </div>
      </Section>

      <Section title="design.d.approval">
        <OverlayApproval
          overlay={overlay}
          verification={verification}
          approved={approved}
          onApprove={() => setApproved({ version: overlay.version, sha256: overlay.sha256 })}
          onRetry={() => {}}
        />
        <OverlayApproval
          overlay={overlay}
          verification={{ state: "mismatch", computed: "9f454886".repeat(8) }}
          approved={null}
          onApprove={() => {}}
          onRetry={() => {}}
        />
      </Section>

      <Section title="design.d.report">
        {content ? (
          <Card>
            <ReportInputsForm value={inputs} content={content} onChange={setInputs} />
          </Card>
        ) : null}
      </Section>

      <Section title="design.d.probe">
        <ProbeReport probe={fixtures.probePass} />
        <ProbeReport
          probe={sampleProbeDrift()}
          rejectedFile="report_v2.rejected_20261012T101500Z.pdf"
        />
      </Section>

      <Section title="design.d.pdf">
        {pdfBytes.state === "error" ? <ErrorPanel error={pdfBytes.error} /> : null}
        <PdfViewer
          data={pdfBytes.state === "match" || pdfBytes.state === "mismatch" ? pdfBytes.bytes : null}
          fileName={report.file}
          verified={pdfBytes.state === "match"}
          className="h-[48rem]"
        />
      </Section>

      <Section title="design.d.history">
        <HistoryTable
          rows={sampleHistoryRows}
          assetUrl={devAssetUrl}
          busyIds={new Set(["20261012_101010_d4e5f6"])}
          onOpen={() => {}}
          onReopen={() => {}}
          onDelete={() => {}}
        />
        <HistoryAdminPanel
          stats={sampleStats}
          reconciled={fixtures.historyList.reconciled}
          onBackup={() => {}}
          onRebuild={() => {}}
        />
      </Section>
    </GalleryShell>
  );
}
