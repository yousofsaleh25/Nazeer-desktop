/**
 * Measuring (#/sessions/:id): the frame the session was created from, the eight measurement kinds
 * (chosen explicitly), the engine's rows as it computes them, and autosave (C3.4). Read-only while
 * the session is finalized or exported (Reopen makes it editable; its outputs become stale). The
 * canvas is an editing view: approval happens on the engine's own image (D7), on the next screen.
 * Leaving the screen, or the window losing focus, flushes the pending autosave.
 */
import { CheckCheck, FileText, LockOpen, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { ApiErrorShape } from "@/api/errors";
import type { InputKind, MeasurementInput, MeasurementRow } from "@/api/types";
import { engineUrl } from "@/api/urls";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { CodeLabel } from "@/components/domain/labels";
import { depthBoxOf, groundLineOf } from "@/components/domain/measure/geometry";
import {
  fitViewport,
  zoomAt,
  zoomOf,
  ZOOM_STEP,
  type Shape,
} from "@/components/domain/measure/interaction";
import type { CanvasFrame, DraftShape, Viewport } from "@/components/domain/measure/MeasureCanvas";
import { MeasurementList } from "@/components/domain/MeasurementList";
import { MeasureToolbar, type CanvasLayers } from "@/components/domain/MeasureToolbar";
import { UnsavedBadge } from "@/components/domain/UnsavedBadge";
import { ZRefCard } from "@/components/domain/ZRefCard";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Ltr } from "@/components/ui/Ltr";
import { STATUS_TONE } from "@/design";
import { messagePair, useT } from "@/i18n/t";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { autosaveFlushRequested } from "@/store/listeners/autosave";
import { sameDocument } from "@/store/session/document";
import { canAddMeasurement, displayRowsOf, saveStateOf } from "@/store/session/selectors";
import {
  canEditSession,
  conflictResolved,
  measurementChanged,
  measurementMoved,
  measurementRemoved,
  previewReset,
  redone,
  selectionChanged,
  textEdited,
  toolChanged,
  undone,
} from "@/store/slices/session";
import { reopenSession } from "@/store/thunks/session";
import { SessionGate, type LoadedSession } from "../session/SessionGate";
import { MeasureStage, type Drawing, type Naming } from "./MeasureStage";
import {
  ColourDialog,
  HoverPanel,
  LinePicker,
  MeasureHint,
  NoteDialog,
  RenameDialog,
  SaveProblems,
  SessionDetailsCard,
} from "./panels";

export function MeasureScreen() {
  const { id = "" } = useParams();
  return (
    <SessionGate id={id}>
      {(session) => <MeasureWorkspace key={session.id} session={session} />}
    </SessionGate>
  );
}

function useDrawing(): Drawing & { reset: () => void } {
  const [shape, setShape] = useState<Shape | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  return {
    shape,
    naming,
    picks,
    setShape,
    setNaming,
    setPicks,
    togglePick: (id: number) => {
      const next = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
      if (next.length === 2) {
        setNaming({ kind: "angle_4point", lines: [next[0]!, next[1]!] });
        setPicks([]);
      } else {
        setPicks(next);
      }
    },
    reset: () => {
      setShape(null);
      setNaming(null);
      setPicks([]);
    },
  };
}

type Editing = { kind: "rename" | "note" | "colour"; id: number } | null;

function MeasureWorkspace({ session }: { session: LoadedSession }) {
  const t = useT();
  const dispatch = useAppDispatch();
  const connection = useAppSelector((state) => state.engine.connection);
  const hintId = `measure-hint${useId()}`;
  const { view, draft, tool, selection } = session;
  const editable = canEditSession(session);
  const drawing = useDrawing();
  const [layers, setLayers] = useState<CanvasLayers>({
    mask: false,
    depthBox: false,
    labels: true,
  });
  const [viewport, setViewport] = useState<Viewport>(() => fitViewport(view.frame));
  const [editing, setEditing] = useState<Editing>(null);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<ApiErrorShape | null>(null);

  // autosave goes out when the screen is left or the window loses focus
  useEffect(() => {
    const flush = () => dispatch(autosaveFlushRequested());
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [dispatch]);

  const previews = session.previews;
  const items = useMemo(
    () => displayRowsOf(draft, view.measurements, previews),
    [draft, view.measurements, previews],
  );
  const rows = useMemo(
    () => items.flatMap((item): MeasurementRow[] => (item.row === null ? [] : [item.row])),
    [items],
  );
  const ghosts = useMemo(
    () =>
      items.flatMap((item): DraftShape[] =>
        item.row === null && (item.input.points ?? []).length > 0
          ? [
              {
                kind: item.input.kind,
                points: item.input.points ?? [],
                targets: item.input.targets ?? [],
                color: item.input.color ?? undefined,
              },
            ]
          : [],
      ),
    [items],
  );
  const inputs = useMemo(
    () => new Map(draft.measurements.map((m): [number, MeasurementInput] => [m.id, m])),
    [draft],
  );
  const names = useMemo(
    () => new Map(draft.measurements.map((m): [number, string] => [m.id, m.name])),
    [draft],
  );
  const frame: CanvasFrame | null = useMemo(
    () =>
      connection === null
        ? null
        : {
            width: view.frame.width,
            height: view.frame.height,
            imageUrl: engineUrl(connection, view.frame.assets.rgb),
            maskUrl: engineUrl(connection, view.frame.assets.mask),
            ground: groundLineOf(view.frame),
            depthBox: depthBoxOf(view.frame),
          },
    [connection, view.frame],
  );

  const onViewport = useCallback(
    (update: (current: Viewport) => Viewport) => setViewport((current) => update(current)),
    [],
  );
  const zoomBy = (factor: number) =>
    setViewport((current) =>
      zoomAt(current, view.frame, factor, [
        current.x + current.width / 2,
        current.y + current.height / 2,
      ]),
    );

  const changeTool = (next: InputKind | null) => {
    drawing.reset();
    dispatch(previewReset());
    dispatch(toolChanged(next));
    // a 4-point angle is previewed against the stored lines: save first
    if (next === "angle_4point") dispatch(autosaveFlushRequested());
  };

  const reopen = async () => {
    setReopening(true);
    setReopenError(await dispatch(reopenSession()));
    setReopening(false);
  };

  const status = view.status;
  const sealed = status !== "open";
  const editingInput = editing === null ? null : (inputs.get(editing.id) ?? null);
  const shownColour =
    editing === null ? null : (rows.find((row) => row.id === editing.id)?.display_color ?? null);
  const actions = editable
    ? {
        onRename: (id: number) => setEditing({ kind: "rename", id }),
        onEditNote: (id: number) => setEditing({ kind: "note", id }),
        onRecolor: (id: number) => setEditing({ kind: "colour", id }),
        onMove: (id: number, delta: -1 | 1) => dispatch(measurementMoved({ id, delta })),
        onDelete: (id: number) => dispatch(measurementRemoved(id)),
      }
    : {};

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">
          {draft.camelId ? (
            <bdi dir="auto">{draft.camelId}</bdi>
          ) : (
            <span className="text-ink-muted">
              <Bi {...messagePair("history.noCamelId")} />
            </span>
          )}
        </h1>
        <Ltr className="font-mono text-xs text-ink-muted">{session.id}</Ltr>
        <Chip tone={STATUS_TONE[status]}>
          <CodeLabel group="statuses" code={status} />
        </Chip>
        <UnsavedBadge state={saveStateOf(session)} revision={session.storedRevision} />
        <div className="ms-auto flex flex-wrap gap-2">
          {sealed ? (
            <>
              <Button onClick={() => void reopen()} loading={reopening}>
                <LockOpen aria-hidden="true" />
                <Bi {...messagePair("history.reopen")} />
              </Button>
              <Button asChild>
                <Link to={`/sessions/${session.id}/finalize`}>
                  <ShieldCheck aria-hidden="true" />
                  <Bi {...messagePair("session.approval")} />
                </Link>
              </Button>
              <Button variant="primary" asChild>
                <Link to={`/sessions/${session.id}/report`}>
                  <FileText aria-hidden="true" />
                  <Bi {...messagePair("session.report")} />
                </Link>
              </Button>
            </>
          ) : (
            <Button variant="primary" asChild>
              <Link to={`/sessions/${session.id}/finalize`}>
                <CheckCheck aria-hidden="true" />
                <Bi {...messagePair("session.finalize")} />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {reopenError ? (
        <ErrorPanel error={reopenError} context={messagePair("session.reopenFailed")} />
      ) : null}
      <SaveProblems
        save={session.save}
        status={status}
        dirty={!sameDocument(draft, session.base)}
        names={names}
        onKeepMine={() => dispatch(conflictResolved("mine"))}
        onTakeTheirs={() => dispatch(conflictResolved("theirs"))}
        onReopen={() => void reopen()}
        reopening={reopening}
      />
      {editable ? <Alert tone="info" title={messagePair("measure.editingView")} /> : null}

      <MeasureToolbar
        tool={tool}
        onToolChange={changeTool}
        canUndo={editable && session.undo.past.length > 0}
        canRedo={editable && session.undo.future.length > 0}
        onUndo={() => dispatch(undone())}
        onRedo={() => dispatch(redone())}
        zoom={zoomOf(viewport, view.frame)}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onZoomReset={() => setViewport(fitViewport(view.frame))}
        layers={layers}
        onLayersChange={setLayers}
        readOnly={!editable}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="flex min-w-0 flex-col gap-3">
          {frame !== null ? (
            <MeasureStage
              frame={frame}
              rows={rows}
              ghosts={ghosts}
              inputs={inputs}
              tool={tool}
              onTool={changeTool}
              drawing={drawing}
              editable={editable}
              canAdd={canAddMeasurement(session)}
              selectedId={selection}
              viewport={viewport}
              onViewport={onViewport}
              layers={layers}
              label={t("measure.canvasLabel")}
              describedBy={hintId}
            />
          ) : null}
          <MeasureHint
            id={hintId}
            tool={tool}
            editable={editable}
            points={drawing.shape?.points.length ?? 0}
          />
          {!canAddMeasurement(session) && editable ? (
            <Alert tone="warning" title={messagePair("measure.full")} />
          ) : null}
          {tool === "angle_4point" && editable ? (
            <LinePicker rows={rows} picks={drawing.picks} onToggle={drawing.togglePick} />
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <HoverPanel tool={tool} />
          <MeasurementList
            items={items}
            summary={view.summary}
            selectedId={selection}
            readOnly={!editable}
            onSelect={(id) => dispatch(selectionChanged(id === selection ? null : id))}
            {...actions}
          />
          <ZRefCard frame={view.frame} summary={view.summary} />
          <SessionDetailsCard
            camelId={draft.camelId}
            operator={draft.operator}
            notes={draft.notes}
            editable={editable}
            onEdit={(field, value) => dispatch(textEdited({ field, value }))}
          />
        </div>
      </div>

      <RenameDialog
        input={editing?.kind === "rename" ? editingInput : null}
        onClose={() => setEditing(null)}
        onRename={(id, name) => {
          dispatch(measurementChanged({ id, changes: { name } }));
          setEditing(null);
        }}
      />
      <NoteDialog
        input={editing?.kind === "note" ? editingInput : null}
        onClose={() => setEditing(null)}
        onSave={(id, note) => {
          dispatch(measurementChanged({ id, changes: { note } }));
          setEditing(null);
        }}
      />
      <ColourDialog
        input={editing?.kind === "colour" ? editingInput : null}
        shown={shownColour}
        onClose={() => setEditing(null)}
        onPick={(id, color) => {
          dispatch(measurementChanged({ id, changes: { color } }));
          setEditing(null);
        }}
      />
    </div>
  );
}
