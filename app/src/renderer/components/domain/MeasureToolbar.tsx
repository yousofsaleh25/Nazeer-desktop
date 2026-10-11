/**
 * The measuring tools: the eight kinds the operator picks explicitly (nothing falls back from 3D to
 * 2D), labelled by the engine (`input_kinds`), with keys 1–8; undo / redo; zoom; and the canvas
 * layers. Disabled when the session is read-only (status ≠ open).
 */
import {
  GitCompareArrows,
  Move3d,
  MoveHorizontal,
  Pyramid,
  Redo2,
  Ruler,
  Spline,
  Triangle,
  Undo2,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { INPUT_KINDS, type InputKind } from "@/api/types";
import { Bi } from "@/components/ui/Bi";
import { IconButton } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Num } from "@/components/ui/Ltr";
import { Switch } from "@/components/ui/Switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToggleGroup, ToggleGroupItem, Toolbar, ToolbarSeparator } from "@/components/ui/Toolbar";
import { messagePair, useT } from "@/i18n/t";
import { CodeLabel, useCodeString } from "./labels";

export const TOOL_ICONS: Record<InputKind, LucideIcon> = {
  distance_2d: Ruler,
  distance_3d: Move3d,
  curve_2d: Spline,
  curve_3d: Waypoints,
  angle_2d_3point: Triangle,
  angle_3d_3point: Pyramid,
  angle_2d_from_horizontal: MoveHorizontal,
  angle_4point: GitCompareArrows,
};

export interface CanvasLayers {
  mask: boolean;
  depthBox: boolean;
  labels: boolean;
}

export interface MeasureToolbarProps {
  tool: InputKind | null;
  onToolChange: (tool: InputKind | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  layers: CanvasLayers;
  onLayersChange: (layers: CanvasLayers) => void;
  readOnly?: boolean;
}

export function MeasureToolbar({
  tool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  layers,
  onLayersChange,
  readOnly = false,
}: MeasureToolbarProps) {
  const t = useT();
  const kindName = useCodeString();
  return (
    <div className="flex flex-col gap-2">
      <Toolbar label={t("measure.toolbar")}>
        <ToggleGroup<InputKind>
          value={tool}
          onValueChange={onToolChange}
          label={t("measure.tools")}
          disabled={readOnly}
        >
          {INPUT_KINDS.map((kind, index) => {
            const Icon = TOOL_ICONS[kind];
            return (
              <Tooltip
                key={kind}
                content={
                  <span className="flex items-center gap-2">
                    <CodeLabel group="input_kinds" code={kind} />
                    <Kbd>{index + 1}</Kbd>
                  </span>
                }
              >
                <span className="inline-flex">
                  <ToggleGroupItem value={kind} label={kindName("input_kinds", kind)}>
                    <Icon aria-hidden="true" />
                    <span aria-hidden="true" className="text-[0.65rem] tabular-nums opacity-70">
                      {index + 1}
                    </span>
                  </ToggleGroupItem>
                </span>
              </Tooltip>
            );
          })}
        </ToggleGroup>
        <ToolbarSeparator />
        <IconButton
          icon={Undo2}
          label={t("measure.undo")}
          tooltip={<ShortcutTip label="measure.undo" keys="Ctrl+Z" />}
          onClick={onUndo}
          disabled={readOnly || !canUndo}
          directional
        />
        <IconButton
          icon={Redo2}
          label={t("measure.redo")}
          tooltip={<ShortcutTip label="measure.redo" keys="Ctrl+Y" />}
          onClick={onRedo}
          disabled={readOnly || !canRedo}
          directional
        />
        <ToolbarSeparator />
        <IconButton
          icon={ZoomOut}
          label={t("measure.zoomOut")}
          tooltip={<ShortcutTip label="measure.zoomOut" keys="−" />}
          onClick={onZoomOut}
        />
        <Tooltip content={<ShortcutTip label="measure.zoomReset" keys="0" />}>
          <button
            type="button"
            onClick={onZoomReset}
            aria-label={t("measure.zoomReset")}
            className="inline-flex min-h-9 min-w-14 items-center justify-center rounded-md px-1 text-sm text-ink-secondary hover:bg-surface-hover"
          >
            <Num value={zoom * 100} unit="%" />
          </button>
        </Tooltip>
        <IconButton
          icon={ZoomIn}
          label={t("measure.zoomIn")}
          tooltip={<ShortcutTip label="measure.zoomIn" keys="+" />}
          onClick={onZoomIn}
        />
      </Toolbar>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        {tool ? (
          <p className="text-sm font-medium text-ink">
            <CodeLabel group="input_kinds" code={tool} />
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            <Bi {...messagePair("measure.noTool")} />
          </p>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-x-4">
          <Switch
            checked={layers.mask}
            onCheckedChange={(mask) => onLayersChange({ ...layers, mask })}
            label={messagePair("measure.layerMask")}
          />
          <Switch
            checked={layers.depthBox}
            onCheckedChange={(depthBox) => onLayersChange({ ...layers, depthBox })}
            label={messagePair("measure.layerDepthBox")}
          />
          <Switch
            checked={layers.labels}
            onCheckedChange={(labels) => onLayersChange({ ...layers, labels })}
            label={messagePair("measure.layerLabels")}
          />
        </div>
      </div>
    </div>
  );
}

function ShortcutTip({ label, keys }: { label: Parameters<typeof messagePair>[0]; keys: string }) {
  return (
    <span className="flex items-center gap-2">
      <Bi {...messagePair(label)} />
      <Kbd>{keys}</Kbd>
    </span>
  );
}
