/**
 * The printed comparison (D12 F2.3, F2.11): laid out from the comparison model and each camel's
 * approved overlay bytes only. The engine matched the rows and wrote every text; nothing here
 * sorts, highlights, subtracts or totals — the camels stay in the operator's order. Sections: the
 * cover (the cover texts, the camels in print order), the comparison table in blocks of camel
 * columns (each block repeats the measurement and kind columns), one section per camel starting on
 * a new page (its heading and approved overlay together, its frame lines, its measurements, its
 * snapped and counts lines, its sources), the signature wells, the provenance and the disclaimers.
 * An overlay appears only in its own camel's section (the engine's ordered pixel probe requires
 * each on exactly one page). One face, weight 400, as the single report (D7 B38).
 */
import type { ReactNode } from "react";
import {
  columnBlocks,
  columnsPerBlock,
  type ComparisonCell,
  type ComparisonPrintMember,
  type ComparisonPrintModel,
  type MemberRow,
} from "./comparisonModel";
import type { FlagChip, Pair } from "./model";
import {
  Chip,
  groupedBasis,
  Heading,
  KeyValue,
  librariesLine,
  Masthead,
  pointLabel,
} from "./PrintPage";
import { L, LanguageContext, Op, Tech } from "./text";

export interface ComparisonPageProps {
  model: ComparisonPrintModel;
  /** blob: URL of each camel's approved overlay bytes, by session id */
  overlayUrls: Record<string, string>;
  logoUrl: string | null;
  /** the comparison model file this page prints (its version and SHA-256, from main) */
  comparisonModel: { version: number; sha256: string };
}

function chipsOf(
  flags: FlagChip[],
  confidence: (Pair & { code: string }) | null,
): { label: Pair; warn: boolean; key: string }[] {
  const chips: { label: Pair; warn: boolean; key: string }[] = flags.map((f) => ({
    label: f,
    warn: f.severity === "warn",
    key: f.code,
  }));
  if (confidence !== null && confidence.code !== "high") {
    chips.push({ label: confidence, warn: true, key: `confidence-${confidence.code}` });
  }
  return chips;
}

function Rejected({ label, parts }: { label: Pair; parts: MemberRow["rejection"] }) {
  return (
    <>
      <span className="text-print-danger">
        <L label={label} />
      </span>
      {parts.map((part, i) => (
        <div key={i} className="print-small text-print-danger">
          {part.point !== null ? <Tech>{part.point}</Tech> : null}
          {part.point !== null ? " " : null}
          <L label={part} />
        </div>
      ))}
    </>
  );
}

/** One camel's cell of the comparison table: its own report's texts, or the engine's "—". */
function Cell({ cell, model }: { cell: ComparisonCell | null; model: ComparisonPrintModel }) {
  if (cell === null) {
    return (
      <td data-missing="">
        <L label={model.labels.missing} />
      </td>
    );
  }
  return (
    <td>
      {cell.rejected || cell.valueText === null ? (
        <Rejected label={model.labels.rejected} parts={cell.rejection} />
      ) : (
        <L label={cell.valueText} block />
      )}
      {cell.uncertaintyText !== null ? (
        <div className="print-small">
          <L label={cell.uncertaintyText} block />
        </div>
      ) : null}
      {cell.depthNote !== null ? (
        <div className="print-small">
          <L label={cell.depthNote} block />
        </div>
      ) : null}
      {chipsOf(cell.flags, cell.confidence).map((chip) => (
        <Chip key={chip.key} label={chip.label} warn={chip.warn} />
      ))}
    </td>
  );
}

function ComparisonTables({ model }: { model: ComparisonPrintModel }) {
  const column = (key: string): Pair => model.labels.columns[key] ?? { ar: key, en: key };
  const blocks = columnBlocks(model.members.length, columnsPerBlock(model.language));
  return (
    <>
      {blocks.map((block) => {
        // the name and kind columns take a fixed share; the camels split the rest equally
        const camelWidth = `${(62 / block.length).toFixed(3)}%`;
        return (
          <table
            key={block[0]}
            className="print-table print-compare"
            data-overflow-check=""
            data-block={block.map((i) => i + 1).join(",")}
          >
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "14%" }} />
              {block.map((i) => (
                <col key={i} style={{ width: camelWidth }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>
                  <L label={column("measurement")} block />
                </th>
                <th>
                  <L label={column("kind")} block />
                </th>
                {block.map((i) => {
                  const m = model.members[i] as ComparisonPrintMember;
                  return (
                    <th key={m.sessionId} data-position={m.position}>
                      <Tech>{`#${m.position}`}</Tech> <Op>{m.camelId}</Op>
                      <div className="print-small">
                        <Tech>{m.sessionId}</Tech>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.rowId} data-row={row.rowId}>
                  <td>
                    {row.unnamed ? <L label={row.nameText} block /> : <Op block>{row.name}</Op>}
                    {row.occurrenceText !== null ? (
                      <div className="print-small">
                        <L label={row.occurrenceText} />
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <L label={row.kindLabel} block />
                  </td>
                  {block.map((i) => (
                    <Cell key={i} cell={row.cells[i] ?? null} model={model} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </>
  );
}

function MemberMeasurement({ row, rejected }: { row: MemberRow; rejected: Pair }) {
  return (
    <tr>
      <td>
        <span className="print-swatch" style={{ backgroundColor: row.color ?? "#999999" }} />{" "}
        <Op>{row.name}</Op>
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
        {row.rejected || row.valueText === null ? (
          <Rejected label={rejected} parts={row.rejection} />
        ) : (
          <L label={row.valueText} block />
        )}
      </td>
      <td>{row.uncertaintyText !== null ? <L label={row.uncertaintyText} block /> : null}</td>
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
        {row.depthNote !== null ? (
          <div className="print-small">
            <L label={row.depthNote} />
          </div>
        ) : null}
        {row.detail !== null ? (
          <div className="print-small">
            <L label={row.detail} />
          </div>
        ) : null}
      </td>
      <td>
        {chipsOf(row.flags, row.confidence).map((chip) => (
          <Chip key={chip.key} label={chip.label} warn={chip.warn} />
        ))}
      </td>
    </tr>
  );
}

function MemberSection({
  member,
  model,
  overlayUrl,
}: {
  member: ComparisonPrintMember;
  model: ComparisonPrintModel;
  overlayUrl: string;
}) {
  const { labels } = model;
  const heading = (key: string): Pair => labels.headings[key] ?? { ar: key, en: key };
  const column = (key: string): Pair => labels.columns[key] ?? { ar: key, en: key };
  const provenance = (key: string): Pair => labels.provenanceRows[key] ?? { ar: key, en: key };
  const { overlay } = member;
  return (
    <section className="break-before-page" data-member={member.sessionId}>
      {/* the heading and the camel's image stay together on the section's first page */}
      <div className="break-inside-avoid">
        <Heading label={member.texts.heading} />
        <figure className="m-0 mt-1.5">
          <img
            data-role="overlay"
            data-member={member.sessionId}
            className="block w-full border border-print-rule"
            src={overlayUrl}
            alt=""
          />
          <figcaption className="print-small">
            <Tech>{`${overlay.file} · ${overlay.width} × ${overlay.height} px · sha256 ${overlay.sha256}`}</Tech>
          </figcaption>
        </figure>
      </div>
      <KeyValue
        rows={[
          [column("session_id"), <Tech>{member.sessionId}</Tech>],
          [column("status"), <L label={member.texts.status} />],
          [column("source_frame"), <L label={member.texts.source} block />],
          [labels.frameRows.zRef, <L label={member.frame.zRef} block />],
          [labels.frameRows.ground, <L label={member.frame.ground} block />],
        ]}
      />
      <Heading label={heading("measurements")} />
      <table className="print-table print-compare" data-overflow-check="">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            {["measurement", "kind", "value", "uncertainty", "depth_basis", "flags"].map((key) => (
              <th key={key}>
                <L label={column(key)} block />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {member.rows.map((row) => (
            <MemberMeasurement key={row.id} row={row} rejected={labels.rejected} />
          ))}
        </tbody>
      </table>
      <div className="print-small mt-1">
        <div>
          <L label={member.summary.snappedText} block />
        </div>
        <div>
          <L label={member.summary.countsText} block />
        </div>
      </div>
      <Heading label={heading("member_provenance")} />
      {(
        [
          ["overlay", member.texts.provenance.overlay],
          ["report_model", member.texts.provenance.reportModel],
          ["session", member.texts.provenance.session],
        ] as const
      ).map(([key, value]) => (
        <div key={key} className="print-small">
          <L label={provenance(key)} />
          {": "}
          <L label={value} />
        </div>
      ))}
    </section>
  );
}

export function ComparisonPage({
  model,
  overlayUrls,
  logoUrl,
  comparisonModel,
}: ComparisonPageProps) {
  const { labels, cover, members } = model;
  const heading = (key: string): Pair => labels.headings[key] ?? { ar: key, en: key };
  const column = (key: string): Pair => labels.columns[key] ?? { ar: key, en: key };
  const coverRow = (key: string): Pair => labels.coverRows[key] ?? { ar: key, en: key };
  const provenance = (key: string): Pair => labels.provenanceRows[key] ?? { ar: key, en: key };
  // the operator's title is operator text; without one, the engine's default title
  const title: ReactNode = cover.title.trim() ? (
    <Op>{cover.title}</Op>
  ) : (
    <L label={cover.titleText} />
  );
  const coverRows: [Pair, ReactNode][] = [
    [
      coverRow("title"),
      cover.title.trim() ? <Op block>{cover.title}</Op> : <L label={cover.titleText} />,
    ],
    [coverRow("event"), <Op block>{cover.event}</Op>],
    [coverRow("judge"), <Op block>{cover.judge}</Op>],
    [coverRow("council"), <Op block>{cover.council}</Op>],
    [coverRow("created"), <Tech>{model.createdAt}</Tech>],
    [coverRow("n_camels"), <Tech>{String(members.length)}</Tech>],
    [coverRow("comparison_id"), <Tech>{model.comparisonId}</Tech>],
  ];
  const provenanceRows: [string, string][] = [
    ["engine", model.engineVersion],
    [
      "comparison_model",
      `comparison_model_v${comparisonModel.version}.json · ${model.schemaVersion} · ` +
        `sha256 ${comparisonModel.sha256} · ${model.generatedAt}`,
    ],
    ["libraries", librariesLine(model.versions)],
  ];

  return (
    <LanguageContext value={model.language}>
      <main className="print-page print-comparison">
        <Masthead
          brand={labels.brand}
          title={title}
          certification={labels.certification}
          logoUrl={logoUrl}
        />

        <section>
          <Heading label={heading("cover")} />
          <KeyValue rows={coverRows} />
        </section>

        <section>
          <Heading label={heading("members")} />
          <table className="print-table print-compare" data-overflow-check="">
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "27%" }} />
              <col style={{ width: "35%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                {["position", "camel_id", "session_id", "source_frame", "status"].map((key) => (
                  <th key={key}>
                    <L label={column(key)} block />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.sessionId} data-position={m.position}>
                  <td>
                    <Tech>{String(m.position)}</Tech>
                  </td>
                  <td>
                    <Op block>{m.camelId}</Op>
                  </td>
                  <td>
                    <Tech>{m.sessionId}</Tech>
                  </td>
                  <td>
                    <L label={m.texts.source} block />
                  </td>
                  <td>
                    <L label={m.texts.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="break-before-page">
          <Heading label={heading("table")} />
          <ComparisonTables model={model} />
        </section>

        {members.map((m) => (
          <MemberSection
            key={m.sessionId}
            member={m}
            model={model}
            overlayUrl={overlayUrls[m.sessionId] ?? ""}
          />
        ))}

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
          {labels.disclaimers.map((disclaimer, i) => (
            <div key={i} className="print-small">
              <L label={disclaimer} />
            </div>
          ))}
        </footer>
      </main>
    </LanguageContext>
  );
}
