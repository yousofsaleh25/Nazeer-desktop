/**
 * What the engine found when it sealed the PDF (C3.7): the verdict, then each probe — the overlay
 * image against the approved pixels, every required name in the text layer, the embedded Plex
 * face (no synthesized Type3 face), and the attached evidence files. On DRIFT the engine kept the
 * refused file; the failures and hints say what to fix before printing again.
 */
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { ReactNode } from "react";
import { summarizeProbe, type ProbeSummary } from "@/api/probe";
import { Alert } from "@/components/ui/Alert";
import { Bi } from "@/components/ui/Bi";
import { Ltr, Num } from "@/components/ui/Ltr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { useLanguage } from "@/design/language";
import { errorLabel, messagePair, translate, type MessageKey } from "@/i18n/t";
import { byteSize } from "@/lib/format";
import { cn } from "@/lib/cn";

function Status({ ok }: { ok: boolean | null }) {
  if (ok === true)
    return <CircleCheck aria-hidden="true" className="size-4.5 shrink-0 text-success-text" />;
  if (ok === false)
    return <CircleX aria-hidden="true" className="size-4.5 shrink-0 text-danger-text" />;
  return <CircleDashed aria-hidden="true" className="size-4.5 shrink-0 text-ink-muted" />;
}

function Section({
  title,
  ok,
  children,
}: {
  title: MessageKey;
  ok: boolean | null;
  children: ReactNode;
}) {
  return (
    <section
      data-ok={ok === null ? "unknown" : String(ok)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Status ok={ok} />
        <Bi {...messagePair(title)} />
        <span className="sr-only">
          <Bi
            {...messagePair(
              ok === true ? "probe.ok" : ok === false ? "probe.failed" : "probe.notChecked",
            )}
          />
        </span>
      </h4>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function CodeList({ codes }: { codes: string[] }) {
  return (
    <ul className="list-inside list-disc">
      {codes.map((code) => {
        const label = errorLabel(code);
        return (
          <li key={code}>{label ? <Bi {...label} /> : <Ltr className="font-mono">{code}</Ltr>}</li>
        );
      })}
    </ul>
  );
}

export interface ProbeReportProps {
  probe: unknown;
  /** file name the engine kept a refused PDF under (DRIFT) */
  rejectedFile?: string | null;
}

export function ProbeReport({ probe, rejectedFile = null }: ProbeReportProps) {
  const { lang } = useLanguage();
  const s: ProbeSummary = summarizeProbe(probe);
  const missing = s.text.names.filter((name) => !name.ok);
  return (
    <div className="flex flex-col gap-3" data-verdict={s.verdict}>
      {s.verdict === "PASS" ? (
        <Alert tone="success" title={messagePair("probe.pass")}>
          <Bi {...messagePair("probe.passExplain")} />
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={messagePair(s.verdict === "DRIFT" ? "probe.drift" : "probe.unknown")}
        >
          {s.hardFailures.length > 0 ? <CodeList codes={s.hardFailures} /> : null}
          {s.hints.length > 0 ? (
            <div>
              <Bi {...messagePair("probe.hints")} />: <CodeList codes={s.hints} />
            </div>
          ) : null}
          {rejectedFile ? (
            <p className="text-xs">
              <Bi {...messagePair("probe.keptAs")} />{" "}
              <Ltr className="font-mono">{rejectedFile}</Ltr>
            </p>
          ) : null}
        </Alert>
      )}
      {s.softFailures.length > 0 ? (
        <Alert tone="warning" title={messagePair("probe.soft")}>
          <CodeList codes={s.softFailures} />
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="probe.pixel" ok={s.pixel.ok}>
          {s.pixel.ok ? (
            <p>
              <Bi {...messagePair("probe.pixelSame")} />{" "}
              {s.pixel.page !== null ? (
                <span className="text-ink-secondary">
                  (<Bi {...messagePair("probe.page")} /> <Num value={s.pixel.page} /> ·{" "}
                  <Bi {...messagePair("probe.maxDiff")} /> <Num value={s.pixel.maxAbsDiff} />)
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-danger-text">
              <bdi dir="ltr" lang="en">
                {s.pixel.reason || "--"}
              </bdi>
            </p>
          )}
        </Section>

        <Section title="probe.text" ok={s.text.ok}>
          <p>
            <Bi {...messagePair("probe.namesFound")} />:{" "}
            <Num value={s.text.names.length - missing.length} /> /{" "}
            <Num value={s.text.names.length} />
          </p>
          {missing.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1">
              {missing.map((name) => (
                <li key={name.name} className="flex flex-wrap gap-1">
                  {name.runs.map((run, i) => (
                    <bdi
                      key={i}
                      dir="auto"
                      className={cn(
                        "rounded-xs px-1",
                        run.found
                          ? "bg-surface-sunken"
                          : "bg-danger-soft font-semibold text-danger-text",
                      )}
                    >
                      {run.text}
                    </bdi>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="probe.fonts" ok={s.fonts.ok}>
          <ul className="flex flex-col gap-0.5">
            {s.fonts.fonts.map((font) => (
              <li key={font}>
                <Ltr className="font-mono text-xs">{font}</Ltr>
              </li>
            ))}
          </ul>
          {s.fonts.type3 ? (
            <p className="text-danger-text">
              <Bi {...messagePair("probe.type3")} />
            </p>
          ) : null}
        </Section>

        <Section title="probe.attachments" ok={s.attachments.ok}>
          {s.attachments.files.length > 0 ? (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>
                    <Bi {...messagePair("probe.file")} />
                  </TableHeaderCell>
                  <TableHeaderCell numeric>
                    <Bi {...messagePair("probe.size")} />
                  </TableHeaderCell>
                  <TableHeaderCell>
                    <Bi {...messagePair("probe.match")} />
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {s.attachments.files.map((file) => {
                  const size = file.bytes === null ? null : byteSize(file.bytes);
                  return (
                    <TableRow key={file.name}>
                      <TableCell>
                        <Ltr className="font-mono text-xs">{file.name}</Ltr>
                      </TableCell>
                      <TableCell numeric>
                        {size ? (
                          <Num
                            value={size.value}
                            digits={size.digits}
                            unit={translate(lang, `units.${size.unit}`)}
                          />
                        ) : (
                          "--"
                        )}
                      </TableCell>
                      <TableCell>
                        <Status ok={file.matches} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
          {s.attachments.reason ? (
            <p className="text-danger-text">
              <bdi dir="ltr" lang="en">
                {s.attachments.reason}
              </bdi>
            </p>
          ) : null}
        </Section>
      </div>

      <p className="flex flex-wrap gap-x-4 text-xs text-ink-muted">
        {s.pages !== null ? (
          <span>
            <Bi {...messagePair("probe.pages")} />: <Num value={s.pages} />
          </span>
        ) : null}
        {s.sha256Out ? <Ltr className="font-mono">{`SHA-256 ${s.sha256Out}`}</Ltr> : null}
      </p>
    </div>
  );
}
