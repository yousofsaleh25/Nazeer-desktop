/**
 * About: which engine, model and text stack this app is talking to (a support call starts here).
 * The connection comes from main's supervisor (ready line); /health adds the run id, start time
 * and the Arabic stack; /versions is the library stamp every session and report carries.
 */
import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import type { NazeerApi } from "@shared/ipc";
import { useGetHealthQuery, useGetVersionsQuery } from "@/api/engineApi";
import { toApiError } from "@/api/errors";
import type { EngineLabels } from "@/api/labels";
import { ErrorPanel } from "@/components/domain/ErrorPanel";
import { LicenseCard } from "@/components/domain/LicenseCard";
import { useLabels } from "@/components/domain/labels";
import { Bi } from "@/components/ui/Bi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Ltr, Num, PathText } from "@/components/ui/Ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { useLanguage } from "@/design/language";
import { messagePair, translate, type MessageKey } from "@/i18n/t";
import { formatDateTime } from "@/lib/format";
import { useAppSelector } from "@/store/hooks";

type Row = [MessageKey, ReactNode];

function InfoList({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[minmax(9rem,max-content)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-secondary">
            <Bi {...messagePair(label)} />
          </dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return <Ltr>--</Ltr>;
  return <Bi {...messagePair(value ? "common.yes" : "common.no")} />;
}

function Hash({ value }: { value: string | null | undefined }) {
  return <Ltr className="font-mono text-xs break-all">{value ?? "--"}</Ltr>;
}

export function About() {
  const connection = useAppSelector((state) => state.engine.connection);
  const health = useGetHealthQuery();
  const versions = useGetVersionsQuery();
  const labels = useLabels();
  const { lang } = useLanguage();
  if (connection === null) return null;
  const api = (window as { nazeer?: NazeerApi }).nazeer;
  const h = health.data;
  const stack = h?.arabic_stack;
  const labelCount =
    labels === null
      ? null
      : (Object.keys(labels) as (keyof EngineLabels)[])
          .filter((group) => group !== "constants")
          .reduce((sum, group) => sum + Object.keys(labels[group]).length, 0);

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="text-2xl font-semibold">
        <Bi {...messagePair("about.title")} />
      </h1>
      {health.error ? (
        <ErrorPanel error={toApiError(health.error)} onRetry={() => void health.refetch()} />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={messagePair("about.engine")} level={2}>
          <InfoList
            rows={[
              ["about.engineVersion", <Ltr key="v">{connection.engineVersion}</Ltr>],
              ["about.enginePid", <Ltr key="p">{connection.pid}</Ltr>],
              ["about.runId", <Hash key="r" value={h?.run_id} />],
              ["about.startedAt", <Ltr key="s">{formatDateTime(h?.started_at)}</Ltr>],
              [
                "about.uptime",
                <Num key="u" value={h?.uptime_s} unit={translate(lang, "units.s")} />,
              ],
              ["about.port", <Ltr key="o">{connection.port}</Ltr>],
              ["about.dataRoot", <PathText key="d" path={connection.dataRoot} />],
              [
                "about.logFolder",
                <span key="l" className="flex flex-wrap items-center gap-2">
                  <PathText path={connection.logDir} />
                  {api ? (
                    <Button size="sm" variant="ghost" onClick={() => void api.app.openLogFolder()}>
                      <FolderOpen aria-hidden="true" />
                      <Bi {...messagePair("engine.openLogs")} />
                    </Button>
                  ) : null}
                </span>,
              ],
            ]}
          />
        </Card>
        <Card title={messagePair("about.model")} level={2}>
          <InfoList
            rows={[
              [
                "about.modelFile",
                <span key="f" className="flex flex-wrap items-center gap-2">
                  <Ltr>{connection.modelFile ?? "--"}</Ltr>
                  {connection.stubModel ? (
                    <Chip tone="warning">
                      <Bi {...messagePair("about.stub")} />
                    </Chip>
                  ) : null}
                </span>,
              ],
              ["about.modelSha", <Hash key="s" value={connection.modelSha256} />],
              ["about.stub", <YesNo key="b" value={connection.stubModel} />],
              [
                "about.warmup",
                <Num key="w" value={connection.warmupMs} unit={translate(lang, "units.ms")} />,
              ],
            ]}
          />
        </Card>
        <Card title={messagePair("about.arabicStack")} level={2}>
          <InfoList
            rows={[
              ["about.stackOk", <YesNo key="o" value={stack?.ok ?? connection.arabicStackOk} />],
              ["about.stackReason", <Ltr key="r">{stack?.reason ? stack.reason : "--"}</Ltr>],
              ["about.fontSha", <Hash key="f" value={stack?.font_sha256} />],
              ["about.fontPinned", <YesNo key="p" value={stack?.font_pinned} />],
              ["about.nativeLayout", <YesNo key="n" value={stack?.native_layout} />],
            ]}
          />
        </Card>
        <Card title={messagePair("about.app")} level={2}>
          <InfoList
            rows={[
              ["about.appVersion", <Ltr key="a">{connection.appVersion}</Ltr>],
              ["about.electron", <Ltr key="e">{connection.electron}</Ltr>],
              ["about.chromium", <Ltr key="c">{connection.chromium}</Ltr>],
              ["about.labelsLoaded", <Ltr key="l">{labelCount ?? "--"}</Ltr>],
            ]}
          />
        </Card>
        <LicenseCard />
      </div>
      <Card title={messagePair("about.versions")} level={2}>
        {versions.error ? (
          <ErrorPanel error={toApiError(versions.error)} onRetry={() => void versions.refetch()} />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>
                  <Bi {...messagePair("about.library")} />
                </TableHeaderCell>
                <TableHeaderCell>
                  <Bi {...messagePair("about.version")} />
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(versions.data ?? {}).map(([name, value]) => (
                <TableRow key={name}>
                  <TableCell>
                    <Ltr className="font-mono text-xs">{name}</Ltr>
                  </TableCell>
                  <TableCell>
                    <Ltr className="font-mono text-xs break-all">
                      {value === null ? "--" : String(value)}
                    </Ltr>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
