/**
 * /design/components (development builds only): every primitive in its states, in the current
 * theme and direction (switch them in the header). Strings are i18n keys like everywhere else.
 */
import { Copy, Pencil, Ruler, Spline, StickyNote, Trash2, Triangle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, Skeleton } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge, Chip } from "@/components/ui/Chip";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Kbd } from "@/components/ui/Kbd";
import { Ltr, Num } from "@/components/ui/Ltr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Menu";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { Spinner } from "@/components/ui/Spinner";
import { SplitPane } from "@/components/ui/SplitPane";
import { Switch } from "@/components/ui/Switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Toaster, type ToastItem } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToggleGroup, ToggleGroupItem, Toolbar, ToolbarSeparator } from "@/components/ui/Toolbar";
import type { Tone } from "@/design";
import { messagePair, useT } from "@/i18n/t";
import { GallerySection as Section, GalleryShell } from "./GalleryShell";

const TONES: Tone[] = [
  "neutral",
  "primary",
  "success",
  "warning",
  "danger",
  "info",
  "side",
  "end",
  "quarter",
];
const VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;
const SAMPLE_ROWS = [
  { name: "ارتفاع الغارب", value: 1.842 },
  { name: "Body length", value: 2.315 },
  { name: "محيط الصدر", value: 2.071 },
];

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export default function ComponentsGallery() {
  const t = useT();
  const [text, setText] = useState("جمل-تجربة-1");
  const [variant, setVariant] = useState<string>("mjaheem");
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);
  const [opacity, setOpacity] = useState(32);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [tool, setTool] = useState<"a" | "b" | "c" | null>("a");
  const demo = (key: Parameters<typeof messagePair>[0]) => messagePair(key);

  const addToast = (tone: ToastItem["tone"]) =>
    setToasts((list) => [
      ...list,
      {
        id: `${tone}-${list.length}`,
        tone,
        title: demo(tone === "danger" ? "errors.backup_failed" : "admin.backupWritten"),
        description: tone === "danger" ? demo("save.offline") : undefined,
      },
    ]);

  return (
    <GalleryShell title="design.componentsTitle" intro="design.componentsIntro">
      <Section title="design.c.buttons">
        <Row>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              <Bi {...demo(`design.demo.${v}`)} />
            </Button>
          ))}
        </Row>
        <Row>
          <Button size="sm">
            <Bi {...demo("common.save")} />
          </Button>
          <Button size="md">
            <Bi {...demo("common.save")} />
          </Button>
          <Button size="lg" variant="primary">
            <Ruler aria-hidden="true" />
            <Bi {...demo("session.start")} />
          </Button>
          <Button loading>
            <Bi {...demo("common.save")} />
          </Button>
          <Button disabled>
            <Bi {...demo("design.demo.disabled")} />
          </Button>
          <IconButton icon={Copy} label={t("common.copy")} />
          <IconButton icon={Trash2} label={t("measure.delete")} variant="danger" size="icon-sm" />
        </Row>
      </Section>

      <Section title="design.c.fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={demo("session.camelId")} hint={demo("session.camelIdHint")}>
            <Input value={text} onChange={(event) => setText(event.target.value)} />
          </Field>
          <Field label={demo("measure.name")} error={demo("design.demo.required")} required>
            <Input placeholder="Withers height" />
          </Field>
          <Field label={demo("bag.pastePath")}>
            <Input
              dir="ltr"
              defaultValue={"E:\\camel_beauty\\nazeer-desktop\\data\\.bag\\20260414_175757-006.bag"}
            />
          </Field>
          <Field label={demo("report.variant")}>
            <Select
              value={variant}
              onValueChange={setVariant}
              options={[
                { value: "mjaheem", label: { ar: "المجاهيم", en: "Mjaheem" } },
                { value: "maghateer", label: { ar: "المغاتير", en: "Maghateer" } },
              ]}
            />
          </Field>
          <Field label={demo("session.notes")} className="sm:col-span-2">
            <Textarea defaultValue={"ملاحظة بالعربية then an English note: 3 legs visible"} />
          </Field>
        </div>
      </Section>

      <Section title="design.c.toggles">
        <Row>
          <Checkbox
            checked={checked}
            onCheckedChange={setChecked}
            label={demo("measure.layerLabels")}
          />
          <Checkbox
            checked="indeterminate"
            onCheckedChange={() => {}}
            label={demo("measure.layerMask")}
          />
          <Switch checked={on} onCheckedChange={setOn} label={demo("measure.layerDepthBox")} />
          <Switch
            checked
            disabled
            onCheckedChange={() => {}}
            label={demo("design.demo.disabled")}
          />
        </Row>
        <Slider
          value={opacity}
          onValueChange={setOpacity}
          min={0}
          max={100}
          step={1}
          label={t("measure.layerMask")}
          valueText={<Num value={opacity} unit="%" />}
          className="max-w-sm"
        />
      </Section>

      <Section title="design.c.tabs">
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">
              <Bi {...demo("measure.listTitle")} />
            </TabsTrigger>
            <TabsTrigger value="readout">
              <Bi {...demo("readout.title")} />
            </TabsTrigger>
            <TabsTrigger value="zref">
              <Bi {...demo("zref.title")} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <Bi {...demo("measure.emptyHint")} />
          </TabsContent>
          <TabsContent value="readout">
            <Bi {...demo("readout.idle")} />
          </TabsContent>
          <TabsContent value="zref">
            <Bi {...demo("zref.median")} />
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="design.c.dialogs">
        <Row>
          <Button onClick={() => setDialog(true)}>
            <Bi {...demo("design.demo.openDialog")} />
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            <Bi {...demo("history.delete")} />
          </Button>
        </Row>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title={demo("session.startTitle")}
          description={demo("session.startDescription")}
          footer={
            <>
              <Button onClick={() => setDialog(false)}>
                <Bi {...demo("common.cancel")} />
              </Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                <Bi {...demo("session.start")} />
              </Button>
            </>
          }
        >
          <Field label={demo("session.camelId")}>
            <Input defaultValue="جمل-تجربة-1" />
          </Field>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={demo("design.demo.deleteTitle")}
          description={demo("design.demo.deleteDescription")}
          confirmLabel={demo("history.delete")}
          tone="danger"
          onConfirm={() => setConfirm(false)}
        />
      </Section>

      <Section title="design.c.tooltips">
        <Row>
          <Tooltip
            content={
              <span className="flex items-center gap-2">
                <Bi {...demo("measure.undo")} />
                <Kbd>Ctrl+Z</Kbd>
              </span>
            }
          >
            <Button>
              <Bi {...demo("measure.undo")} />
            </Button>
          </Tooltip>
          <span dir="ltr" className="flex items-center gap-1 text-sm">
            <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
          </span>
          <Kbd>1</Kbd>
          <Kbd>Esc</Kbd>
        </Row>
      </Section>

      <Section title="design.c.toasts">
        <Row>
          <Button onClick={() => addToast("success")}>
            <Bi {...demo("design.demo.showNotice")} />
          </Button>
          <Button variant="danger" onClick={() => addToast("danger")}>
            <Bi {...demo("design.demo.showError")} />
          </Button>
        </Row>
        <Toaster
          toasts={toasts}
          onDismiss={(id) => setToasts((list) => list.filter((x) => x.id !== id))}
        />
      </Section>

      <Section title="design.c.chips">
        <Row>
          {TONES.map((tone) => (
            <Chip key={tone} tone={tone}>
              <Ltr>{tone}</Ltr>
            </Chip>
          ))}
        </Row>
        <Row>
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              <Ltr>{tone}</Ltr>
            </Badge>
          ))}
        </Row>
      </Section>

      <Section title="design.c.progress">
        <div className="grid max-w-xl gap-3">
          <ProgressBar value={0.62} label={t("job.progress")} />
          <ProgressBar value={1} label={t("job.progress")} tone="success" />
          <ProgressBar value={0.31} label={t("job.progress")} tone="danger" />
          <ProgressBar value={null} label={t("pdf.loading")} />
        </div>
        <Row>
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" label={t("pdf.loading")} />
        </Row>
        <div className="grid max-w-md gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4" />
          <Skeleton className="h-24" />
        </div>
      </Section>

      <Section title="design.c.surfaces">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={demo("measure.listTitle")}
            actions={<IconButton icon={Pencil} size="icon-sm" label={t("measure.rename")} />}
          >
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>
                    <Bi {...demo("measure.name")} />
                  </TableHeaderCell>
                  <TableHeaderCell numeric>
                    <Bi {...demo("design.demo.value")} />
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {SAMPLE_ROWS.map((row, i) => (
                  <TableRow key={row.name} selected={i === 1}>
                    <TableCell>
                      <bdi dir="auto">{row.name}</bdi>
                    </TableCell>
                    <TableCell numeric>
                      <Num value={row.value} digits={3} unit={t("units.m")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <EmptyState
            icon={Ruler}
            title={demo("measure.empty")}
            description={demo("measure.emptyHint")}
            action={
              <Button variant="primary">
                <Bi {...demo("session.start")} />
              </Button>
            }
          />
        </div>
      </Section>

      <Section title="design.c.alerts">
        <Alert tone="info" title={demo("approval.title")}>
          <Bi {...demo("approval.explain")} />
        </Alert>
        <Alert tone="success" title={demo("probe.pass")} />
        <Alert tone="warning" title={demo("candidates.partial")}>
          <bdi dir="ltr" lang="en">
            only 3 frames passed (m = 12)
          </bdi>
        </Alert>
        <Alert
          tone="danger"
          title={demo("approval.mismatch")}
          actions={
            <Button size="sm">
              <Bi {...demo("common.retry")} />
            </Button>
          }
        >
          <Bi {...demo("approval.mismatchExplain")} />
        </Alert>
        <Alert tone="neutral" title={demo("save.blocked")} />
      </Section>

      <Section title="design.c.layout">
        <div className="h-56 overflow-hidden rounded-lg border border-border bg-surface">
          <SplitPane
            label={t("design.demo.resize")}
            defaultSize={260}
            minSize={180}
            maxSize={420}
            start={
              <ScrollArea className="h-56" label={t("measure.listTitle")}>
                <ol className="flex flex-col divide-y divide-border">
                  {Array.from({ length: 14 }, (_, i) => (
                    <li key={i} className="px-3 py-2 text-sm">
                      <Bi {...demo("measure.name")} /> <Ltr>{`#${i + 1}`}</Ltr>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            }
            end={
              <div className="flex h-56 items-center justify-center bg-surface-sunken text-sm text-ink-muted">
                <Bi {...demo("design.demo.canvasArea")} />
              </div>
            }
          />
        </div>
        <Toolbar label={t("measure.toolbar")}>
          <ToggleGroup value={tool} onValueChange={setTool} label={t("measure.tools")}>
            <ToggleGroupItem value="a" label="2D">
              <Ruler aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem value="b" label="curve">
              <Spline aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem value="c" label="angle">
              <Triangle aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
          <ToolbarSeparator />
          <IconButton icon={Copy} label={t("common.copy")} />
        </Toolbar>
      </Section>

      <Section title="design.c.menus">
        <Row>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Bi {...demo("measure.actions")} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={Pencil}>
                <Bi {...demo("measure.rename")} />
              </DropdownMenuItem>
              <DropdownMenuItem icon={StickyNote}>
                <Bi {...demo("measure.editNote")} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={Trash2} tone="danger">
                <Bi {...demo("measure.delete")} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button>
                <Bi {...demo("measure.name")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t("measure.name")}>
              <Field label={demo("measure.name")}>
                <Input defaultValue="طول الجسم" />
              </Field>
            </PopoverContent>
          </Popover>
        </Row>
      </Section>
    </GalleryShell>
  );
}
