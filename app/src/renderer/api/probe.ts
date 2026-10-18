/**
 * The engine's PDF probe result (`POST …/report` → `probe`, and a DRIFT 409's `details.probe`),
 * typed as a free object by the OpenAPI. These readers pull out what ProbeReport shows; anything
 * missing reads as "not checked", never as a pass. A comparison's probe (D12) also checks each
 * camel: its image on one page, in order, and its names within its own pages (`members`).
 */
import {
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readString,
  readStrings,
} from "@/lib/read";

export type ProbeVerdict = "PASS" | "DRIFT" | "UNKNOWN";

export interface ProbeNameRun {
  text: string;
  found: boolean;
}

export interface ProbeName {
  name: string;
  ok: boolean;
  runs: ProbeNameRun[];
}

export interface ProbeAttachment {
  name: string;
  sha256: string | null;
  bytes: number | null;
  matches: boolean | null;
}

/** One camel of a comparison's probe: its image's page, and its names within its pages. */
export interface ProbeMember {
  position: number;
  imageOk: boolean | null;
  reason: string;
  page: number | null;
  maxAbsDiff: number | null;
  textOk: boolean | null;
  /** [first, last] page of its section */
  pages: [number, number] | null;
  missing: string[];
}

export interface ProbeSummary {
  verdict: ProbeVerdict;
  hardFailures: string[];
  softFailures: string[];
  hints: string[];
  pages: number | null;
  pixel: { ok: boolean | null; reason: string; page: number | null; maxAbsDiff: number | null };
  text: { ok: boolean | null; missing: number | null; names: ProbeName[] };
  fonts: { ok: boolean | null; fonts: string[]; type3: boolean | null; required: string | null };
  attachments: { ok: boolean | null; reason: string; files: ProbeAttachment[] };
  /** a comparison's camels (empty for a session's report) */
  members: ProbeMember[];
  sha256Out: string | null;
}

function probeMembers(pixel: unknown, text: unknown): ProbeMember[] {
  const byText = new Map(
    (readArray(text, "members") ?? []).map((entry) => [readNumber(entry, "position"), entry]),
  );
  return (readArray(pixel, "members") ?? []).flatMap((entry) => {
    const position = readNumber(entry, "position");
    if (position === null) return [];
    const words = byText.get(position);
    const range = readArray(words, "pages");
    const first = typeof range?.[0] === "number" ? range[0] : null;
    const last = typeof range?.[1] === "number" ? range[1] : null;
    return [
      {
        position,
        imageOk: readBoolean(entry, "ok"),
        reason: readString(entry, "reason") ?? "",
        page: readNumber(entry, "page"),
        maxAbsDiff: readNumber(entry, "max_abs_diff"),
        textOk: readBoolean(words, "checked") === true ? readBoolean(words, "ok") : null,
        pages: first !== null && last !== null ? [first, last] : null,
        missing: (readArray(words, "names") ?? []).flatMap((name) =>
          readBoolean(name, "ok") === false ? [readString(name, "name") ?? ""] : [],
        ),
      },
    ];
  });
}

export function summarizeProbe(probe: unknown): ProbeSummary {
  const verdict = readString(probe, "verdict");
  const pixel = readRecord(probe, "pixel");
  const match = readRecord(pixel, "match");
  const text = readRecord(probe, "text");
  const fonts = readRecord(probe, "fonts");
  const attachments = readRecord(probe, "attachments");
  const files = readRecord(attachments, "files") ?? {};
  return {
    verdict: verdict === "PASS" || verdict === "DRIFT" ? verdict : "UNKNOWN",
    hardFailures: readStrings(probe, "hard_failures"),
    softFailures: readStrings(probe, "soft_failures"),
    hints: readStrings(probe, "hints"),
    pages: readNumber(probe, "n_pages"),
    pixel: {
      ok: readBoolean(pixel, "ok"),
      reason: readString(pixel, "reason") ?? readStrings(pixel, "reasons").join(", "),
      page: readNumber(match, "page"),
      maxAbsDiff: readNumber(match, "max_abs_diff"),
    },
    text: {
      ok: readBoolean(text, "ok"),
      missing: readNumber(text, "n_missing"),
      names: (readArray(text, "names") ?? []).flatMap((entry) => {
        const name = readString(entry, "name");
        if (name === null) return [];
        const runs = (readArray(entry, "runs") ?? []).flatMap((run) => {
          const runText = readString(run, "text");
          return runText === null
            ? []
            : [{ text: runText, found: readBoolean(run, "found") === true }];
        });
        return [{ name, ok: readBoolean(entry, "ok") === true, runs }];
      }),
    },
    fonts: {
      ok: readBoolean(fonts, "ok"),
      fonts: readStrings(fonts, "fonts"),
      type3: readBoolean(fonts, "type3_present"),
      required: readString(fonts, "required_token"),
    },
    attachments: {
      ok: readBoolean(attachments, "ok"),
      reason: readString(attachments, "reason") ?? "",
      files: Object.entries(files).map(([name, info]) => ({
        name,
        sha256: readString(info, "sha256"),
        bytes: readNumber(info, "bytes"),
        matches: readBoolean(info, "matches"),
      })),
    },
    members: probeMembers(pixel, text),
    sha256Out: readString(probe, "sha256_out"),
  };
}
