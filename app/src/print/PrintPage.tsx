/**
 * The printed report (ADR-D7): laid out from the report model and the approved overlay bytes
 * only — every label, value and flag is the engine's text, nothing is computed here. One embedded
 * face (the engine's IBM Plex Sans Arabic Regular) and no bold or italic anywhere: a synthesized
 * face would put the operator's names into unsearchable Type3 glyphs (D7 B38). Sections follow
 * the parent's judge form: header, session, frame block, the camel view, the measurements, the
 * empty scoring form, observations, signature wells, the 27 regions, provenance.
 */
import type { ReactNode } from "react";
import type { BasisEntry, FlagChip, Pair, PrintModel, PrintRow } from "./model";
import { FRAME_ROW_KEYS } from "./model";
import { L, LanguageContext, Op, Tech } from "./text";

export interface PrintPageProps {
  model: PrintModel;
  /** blob: URL of the approved overlay bytes */
  overlayUrl: string;
  /** blob: URL of the engine's logo, or null */
  logoUrl: string | null;
  /** the report model file this page prints (its version and SHA-256, from main) */
  reportModel: { version: number; sha256: string };
}

export function Heading({ label }: { label: Pair }) {
  return (
    <h2 className="print-h2">
      <L label={label} />
    </h2>
  );
}

export function KeyValue({ rows }: { rows: [Pair, ReactNode][] }) {
  return (
    <table className="print-table print-kv">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i}>
            <th>
              <L label={label} />
            </th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Chip({ label, warn }: { label: Pair; warn: boolean }) {
  return (
    <span className={warn ? "print-chip print-chip-warn" : "print-chip"}>
      <L label={label} block />
    </span>
  );
}

export function pointLabel(points: (number | null)[]): string | null {
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  if (first === null) return null;
  return points.length === 1 || last === null ? `P${first}` : `P${first}–P${last}`;
}

/** Consecutive points with the same basis share one line ("P1–P5 Z_ref 2.329 m" once). */
export function groupedBasis(entries: BasisEntry[]): { points: (number | null)[]; label: Pair }[] {
  const groups: { points: (number | null)[]; label: Pair }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.label.ar === entry.ar && last.label.en === entry.en) {
      last.points.push(entry.point);
    } else {
      groups.push({ points: [entry.point], label: { ar: entry.ar, en: entry.en } });
    }
  }
  return groups;
}

function MeasurementRow({ row, rejectedLabel }: { row: PrintRow; rejectedLabel: Pair }) {
  const flags: { label: Pair; warn: boolean; key: string }[] = row.flags.map((f: FlagChip) => ({
    label: f,
    warn: f.severity === "warn",
    key: f.code,
  }));
  if (row.confidence !== null && row.confidence.code !== "high") {
    flags.push({ label: row.confidence, warn: true, key: `confidence-${row.confidence.code}` });
  }
  const unc = row.uncertaintyText;
  return (
    <tr>
      <td>
        <span className="print-swatch" style={{ backgroundColor: row.color ?? "#999999" }} />
      </td>
      <td>
        <Op block>{row.name}</Op>
        {row.note ? (
          <div className="print-small">
            <Op block>{row.note}</Op>
          </div>
        ) : null}
      </td>
      <td>
        <L label={row.kindLabel} block />
      </td>
      <td>
        {row.rejected ? (
          <>
            <span className="text-print-danger">
              <L label={rejectedLabel} />
            </span>
            {row.rejection.map((part, i) => (
              <div key={i} className="print-small text-print-danger">
                {part.point !== null ? <Tech>{part.point}</Tech> : null}
                {part.point !== null ? " " : null}
                <L label={part} />
              </div>
            ))}
          </>
        ) : (
          <span className="whitespace-nowrap">
            <L label={row.valueText} block />
          </span>
        )}
      </td>
      <td>{unc.ar || unc.en ? <L label={unc} block /> : null}</td>
      <td>
        {groupedBasis(row.depthBasis).map((group, i) => {
          const points = pointLabel(group.points);
          return (
            <div key={i}>
              {points !== null ? <Tech>{points}</Tech> : null}
              {points !== null ? " " : null}
              <L label={group.label} />
            </div>
          );
        })}
        {row.crossCheck !== null ? (
          <div className="print-small">
            <L label={row.crossCheck} />
          </div>
        ) : null}
        {row.lines !== null ? (
          <div className="print-small">
            <L label={row.lines} />
          </div>
        ) : null}
      </td>
      <td>
        {flags.map((flag) => (
          <Chip key={flag.key} label={flag.label} warn={flag.warn} />
        ))}
      </td>
    </tr>
  );
}

/** The page's head: the logo, the brand, the title and the certification lines. */
export function Masthead({
  brand,
  title,
  certification,
  logoUrl,
}: {
  brand: Pair;
  title: ReactNode;
  certification: Pair[];
  logoUrl: string | null;
}) {
  return (
    <header className="flex items-center gap-3 border-b-2 border-print-accent pb-1.5">
      {logoUrl !== null ? <img className="h-11.5 w-auto" src={logoUrl} alt="" /> : null}
      <div>
        <div className="text-[17pt] leading-tight text-print-brand">
          <L label={brand} />
        </div>
        <div className="text-[12pt]">{title}</div>
        <div className="text-[7.5pt] text-print-muted">
          {certification.map((line, i) => (
            <div key={i}>
              <L label={line} />
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

/** The libraries line of the provenance footer: the data root (a folder on this computer; on the
 * field laptop it names the Windows user) stays in the attached files, not on the printed page. */
export function librariesLine(versions: [string, string][]): string {
  return versions
    .filter(([name]) => name !== "data_root")
    .map(([name, version]) => `${name} ${version}`)
    .join(", ");
}

export function PrintPage({ model, overlayUrl, logoUrl, reportModel }: PrintPageProps) {
  const { labels, session, frame, overlay, summary } = model;
  const h = labels.headings;
  const cols = labels.columns;
  const heading = (key: string): Pair => h[key] ?? { ar: key, en: key };
  const column = (key: string): Pair => cols[key] ?? { ar: key, en: key };
  const sessionRow = (key: string): Pair => labels.sessionRows[key] ?? { ar: key, en: key };
  const provenance = (key: string): Pair => labels.provenanceRows[key] ?? { ar: key, en: key };

  const sessionRows: [Pair, ReactNode][] = [
    [sessionRow("session_id"), <Tech>{session.sessionId}</Tech>],
    [sessionRow("operator"), <Op block>{session.operator}</Op>],
    [sessionRow("camel_id"), <Op block>{session.camelId}</Op>],
    [sessionRow("event"), <Op block>{model.names["event"] ?? ""}</Op>],
    [sessionRow("n_measurements"), <Tech>{String(summary.nMeasurements)}</Tech>],
    [
      sessionRow("source_frame"),
      <>
        <Op block>{frame.bagName}</Op>
        <L label={frame.texts.source} block />
      </>,
    ],
    [sessionRow("generated"), <Tech>{model.generatedAt}</Tech>],
  ];
  if (session.notes) sessionRows.push([column("notes"), <Op block>{session.notes}</Op>]);

  const measurementColumns = [
    "color",
    "measurement",
    "kind",
    "value",
    "uncertainty",
    "depth_basis",
    "flags",
  ];
  const libraries = librariesLine(model.versions);
  const provenanceRows: [string, string][] = [
    ["engine", model.engineVersion],
    [
      "report_model",
      `report_model_v${reportModel.version}.json · ${model.schemaVersion} · sha256 ${reportModel.sha256}`,
    ],
    [
      "overlay",
      `${overlay.file} · ${overlay.width} × ${overlay.height} px · sha256 ${overlay.sha256}`,
    ],
    ["session", `${session.sessionId} · r${session.revision}`],
    ["libraries", libraries],
  ];

  return (
    <LanguageContext value={model.language}>
      <main className="print-page">
        <Masthead
          brand={labels.brand}
          title={<L label={labels.title} />}
          certification={labels.certification}
          logoUrl={logoUrl}
        />

        <section>
          <Heading label={heading("session")} />
          <KeyValue rows={sessionRows} />
        </section>

        <section>
          <Heading label={heading("depth")} />
          <KeyValue
            rows={FRAME_ROW_KEYS.map((key): [Pair, ReactNode] => [
              labels.frameRows[key],
              <L label={frame.texts[key]} block />,
            ])}
          />
        </section>

        <section className="break-inside-avoid">
          <Heading label={heading("camel_view")} />
          <figure className="m-0 mt-1.5">
            <img
              data-role="overlay"
              className="block w-full border border-print-rule"
              src={overlayUrl}
              alt=""
            />
            <figcaption className="print-small">
              <Tech>{`${overlay.file} · ${overlay.width} × ${overlay.height} px · sha256 ${overlay.sha256}`}</Tech>
            </figcaption>
          </figure>
        </section>

        <section>
          <Heading label={heading("measurements")} />
          <table className="print-table">
            <thead>
              <tr>
                {measurementColumns.map((key) => (
                  <th key={key}>
                    <L label={column(key)} block />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <MeasurementRow key={row.id} row={row} rejectedLabel={labels.rejected} />
              ))}
            </tbody>
          </table>
          <div className="print-small mt-1">
            <div>
              <L label={summary.snappedText} block />
            </div>
            <div>
              <L label={summary.countsText} block />
            </div>
          </div>
        </section>

        <section className="break-before-page">
          <Heading label={heading("scoring_form")} />
          <p className="print-small">
            <L label={heading("form_variant")} /> <L label={model.rubric.variantLabel} />
          </p>
          <table className="print-table">
            <thead>
              <tr>
                {["region", "weight", "judge_score", "notes"].map((key) => (
                  <th key={key}>
                    <L label={column(key)} block />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rubric.rows.map((r) => (
                <tr key={r.num}>
                  <td>
                    <Tech>{String(r.num)}</Tech> <L label={r} />
                  </td>
                  <td className="whitespace-nowrap">
                    <Tech>{`${r.weight} %`}</Tech>
                  </td>
                  <td />
                  <td />
                </tr>
              ))}
              <tr>
                <th>
                  <L label={column("total")} />
                </th>
                <th className="whitespace-nowrap">
                  <Tech>{`${model.rubric.totalWeight} %`}</Tech>
                </th>
                <th />
                <th />
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <Heading label={heading("observations")} />
          <KeyValue
            rows={model.observationFields.map((field): [Pair, ReactNode] => {
              const value = model.observations[field.key] ?? "";
              return [
                field,
                value ? (
                  <Op block>{value}</Op>
                ) : (
                  <>
                    {field.placeholder ? (
                      <div className="print-small">
                        <Op block>{field.placeholder}</Op>
                      </div>
                    ) : null}
                    <div className="print-blank" />
                  </>
                ),
              ];
            })}
          />
        </section>

        <section className="break-inside-avoid">
          <Heading label={heading("signatures")} />
          <div className="mt-1.5 flex gap-3">
            {model.signatureWells.map((well) => (
              <div key={well.id} className="flex-1 border border-print-rule px-2 py-1.5">
                <div>
                  <L label={well} />
                </div>
                <div className="print-small">
                  <L label={labels.signatureFields.name} />
                  {": "}
                  <Op>{well.name}</Op>
                </div>
                <div className="my-1.5 h-13.5 border-b border-print-line" />
                <div className="print-small">
                  <L label={labels.signatureFields.date} />
                  {":"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="break-before-page">
          <Heading label={heading("regions")} />
          <table className="print-table">
            <thead>
              <tr>
                <th>
                  <Tech>#</Tech>
                </th>
                {["arabic_name", "english", "body_part"].map((key) => (
                  <th key={key}>
                    <L label={column(key)} block />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.regions.map((r) => (
                <tr key={r.num}>
                  <td>
                    <Tech>{String(r.num)}</Tech>
                  </td>
                  <td lang="ar" dir="rtl">
                    {r.ar}
                  </td>
                  <td>
                    <Tech>{r.en}</Tech>
                  </td>
                  <td lang="ar" dir="rtl">
                    {r.bodyPartAr}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="mt-2.5 border-t border-print-rule-soft pt-1">
          <div>
            <L label={heading("provenance")} />
          </div>
          {provenanceRows.map(([key, value]) =>
            value ? (
              <div key={key} className="print-small">
                <L label={provenance(key)} />
                {": "}
                <Tech>{value}</Tech>
              </div>
            ) : null,
          )}
          <div className="print-small">
            <L label={labels.disclaimer} />
          </div>
        </footer>
      </main>
    </LanguageContext>
  );
}
