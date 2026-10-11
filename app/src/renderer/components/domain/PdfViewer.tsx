/**
 * The sealed PDF, shown in the app for final sign-off (bundled pdf.js, offline). The caller hands
 * in the bytes it fetched and checked against `outputs.report.sha256`; the document is destroyed
 * when the bytes change or the viewer unmounts (before a session is deleted, for instance).
 * Page navigation and zoom; "fit width" is the default.
 */
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Maximize2,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Ltr, Num } from "@/components/ui/Ltr";
import { Spinner } from "@/components/ui/Spinner";
import { messagePair, useT } from "@/i18n/t";
import { cn } from "@/lib/cn";
import { loadPdf, type PdfDocumentLike, type PdfLoader, type PdfRenderTaskLike } from "@/lib/pdf";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export interface PdfViewerProps {
  data: Uint8Array | null;
  /** shown in the toolbar and used as the accessible name */
  fileName: string;
  /** the caller checked the bytes against the engine's SHA-256 */
  verified?: boolean;
  loader?: PdfLoader;
  className?: string;
}

export function PdfViewer({
  data,
  fileName,
  verified = false,
  loader = loadPdf,
  className,
}: PdfViewerProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState<{ data: Uint8Array; doc: PdfDocumentLike } | null>(null);
  const [failed, setFailed] = useState<{ data: Uint8Array; message: string } | null>(null);
  const [pageState, setPageState] = useState<{ data: Uint8Array | null; page: number }>({
    data,
    page: 1,
  });
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [stageWidth, setStageWidth] = useState(0);
  const [shownScale, setShownScale] = useState<number | null>(null);

  const doc = loaded !== null && loaded.data === data ? loaded.doc : null;
  const error = failed !== null && failed.data === data ? failed.message : null;
  const pages = doc?.numPages ?? 0;
  const page = pageState.data === data ? Math.min(pageState.page, Math.max(1, pages)) : 1;

  useEffect(() => {
    if (data === null) return;
    const task = loader(data);
    let alive = true;
    task.promise.then(
      (next) => {
        if (alive) setLoaded({ data, doc: next });
      },
      (reason: unknown) => {
        if (alive)
          setFailed({ data, message: reason instanceof Error ? reason.message : String(reason) });
      },
    );
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [data, loader]);

  useEffect(() => {
    if (stage === null) return;
    const observer = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (doc === null || canvas === null) return;
    let cancelled = false;
    let task: PdfRenderTaskLike | null = null;
    void doc.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const fit = stageWidth > 0 ? Math.max(0.25, (stageWidth - 32) / natural.width) : 1;
      const scale = zoom === "fit" ? fit : zoom;
      const ratio = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
      task = pdfPage.render({ canvas, viewport });
      task.promise.then(
        () => {
          if (!cancelled) setShownScale(scale);
        },
        () => undefined, // cancelled by a newer render
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom, stageWidth]);

  const goTo = (next: number) => setPageState({ data, page: Math.min(Math.max(1, next), pages) });
  const step = (direction: 1 | -1) => {
    const current = shownScale ?? 1;
    const next =
      direction > 0
        ? ZOOM_STEPS.find((s) => s > current + 0.01)
        : [...ZOOM_STEPS].reverse().find((s) => s < current - 0.01);
    if (next !== undefined) setZoom(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "PageDown") goTo(page + 1);
    else if (event.key === "PageUp") goTo(page - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <Ltr className="me-2 truncate text-sm font-medium">{fileName}</Ltr>
        {verified ? (
          <Chip tone="success" icon={ShieldCheck}>
            <Bi {...messagePair("pdf.verified")} />
          </Chip>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          <IconButton
            icon={ChevronLeft}
            directional
            label={t("pdf.previous")}
            disabled={doc === null || page <= 1}
            onClick={() => goTo(page - 1)}
          />
          <span className="min-w-14 text-center text-sm text-ink-secondary" aria-live="polite">
            <span className="sr-only">{t("pdf.page")} </span>
            <Ltr>{doc ? `${page} / ${pages}` : "-- / --"}</Ltr>
          </span>
          <IconButton
            icon={ChevronRight}
            directional
            label={t("pdf.next")}
            disabled={doc === null || page >= pages}
            onClick={() => goTo(page + 1)}
          />
          <IconButton
            icon={ZoomOut}
            label={t("pdf.zoomOut")}
            disabled={doc === null}
            onClick={() => step(-1)}
          />
          <span className="min-w-12 text-center text-sm text-ink-secondary">
            <Num value={shownScale === null ? null : shownScale * 100} unit="%" />
          </span>
          <IconButton
            icon={ZoomIn}
            label={t("pdf.zoomIn")}
            disabled={doc === null}
            onClick={() => step(1)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={doc === null || zoom === "fit"}
            onClick={() => setZoom("fit")}
          >
            <Maximize2 aria-hidden="true" />
            <Bi {...messagePair("pdf.fitWidth")} />
          </Button>
        </div>
      </div>
      <div
        ref={setStage}
        tabIndex={0}
        role="region"
        aria-label={fileName}
        onKeyDown={onKeyDown}
        className="relative min-h-64 flex-1 overflow-auto bg-surface-sunken p-4"
      >
        {data === null ? (
          <p className="text-sm text-ink-muted">
            <Bi {...messagePair("pdf.none")} />
          </p>
        ) : error !== null ? (
          <Alert tone="danger" icon={FileWarning} title={messagePair("pdf.failed")}>
            <bdi dir="ltr" lang="en">
              {error}
            </bdi>
          </Alert>
        ) : doc === null ? (
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            <Spinner size="sm" />
            <Bi {...messagePair("pdf.loading")} />
          </p>
        ) : null}
        {/* pdf.js draws each glyph with canvas text, whose direction is inherited from the
            element: in the right-to-left page every glyph landed one advance too far left */}
        <canvas
          ref={canvasRef}
          dir="ltr"
          role="img"
          aria-label={`${t("pdf.page")} ${page} / ${pages}`}
          className={cn("mx-auto block bg-white shadow-md", doc === null && "hidden")}
        />
      </div>
    </div>
  );
}
